import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { OnEvent } from '@nestjs/event-emitter';
import sgMail from '@sendgrid/mail';
import { PrismaService } from '../../database/prisma.service';
import { QUEUE_NAMES, JOB_NAMES } from '../../queues/queue.constants';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    @InjectQueue(QUEUE_NAMES.NOTIFICATIONS) private notifQueue: Queue,
  ) {
    sgMail.setApiKey(config.get('SENDGRID_API_KEY', ''));
  }

  @OnEvent('review.completed')
  async onReviewCompleted(payload: {
    reviewJobId: string;
    pullRequestId: string;
    commentsCount: number;
    qualityScore: number;
    summary: string;
  }) {
    const pr = await this.prisma.pullRequest.findUnique({
      where: { id: payload.pullRequestId },
      include: {
        repository: { select: { fullName: true } },
        reviewJobs: { where: { id: payload.reviewJobId } },
      },
    });
    if (!pr) return;

    // Find all org members who have email notifications enabled
    const members = await this.prisma.organizationMember.findMany({
      where: { organizationId: pr.organizationId },
      include: { user: { select: { email: true, name: true } } },
    });

    for (const member of members) {
      await this.notifQueue.add(JOB_NAMES.SEND_EMAIL, {
        to: member.user.email,
        templateId: 'review-complete',
        data: {
          userName: member.user.name,
          prTitle: pr.title,
          repoName: pr.repository.fullName,
          commentsCount: payload.commentsCount,
          qualityScore: payload.qualityScore,
          summary: payload.summary,
          prUrl: `${this.config.get('APP_URL')}/dashboard/pull-requests/${pr.id}`,
        },
      });
    }
  }

  async sendEmail(to: string, subject: string, htmlContent: string) {
    try {
      await sgMail.send({
        to,
        from: {
          email: this.config.get('EMAIL_FROM', 'noreply@aicodereview.io'),
          name: this.config.get('EMAIL_FROM_NAME', 'AI Code Review'),
        },
        subject,
        html: htmlContent,
      });
    } catch (err) {
      this.logger.error(`Email send failed to ${to}`, err);
      throw err;
    }
  }

  async sendSlackNotification(webhookUrl: string, message: object) {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
    if (!response.ok) {
      throw new Error(`Slack notification failed: ${response.status}`);
    }
  }
}
