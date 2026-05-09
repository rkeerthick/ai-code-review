import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { QUEUE_NAMES, JOB_NAMES } from '../../queues/queue.constants';

@Processor(QUEUE_NAMES.NOTIFICATIONS)
export class NotificationsProcessor {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(private notifications: NotificationsService) {}

  @Process(JOB_NAMES.SEND_EMAIL)
  async handleEmail(job: Job<{ to: string; templateId: string; data: any }>) {
    const { to, templateId, data } = job.data;
    this.logger.debug(`Sending ${templateId} email to ${to}`);

    const subject = this.getSubject(templateId, data);
    const html = this.renderTemplate(templateId, data);
    await this.notifications.sendEmail(to, subject, html);
  }

  @Process(JOB_NAMES.SEND_SLACK)
  async handleSlack(job: Job<{ webhookUrl: string; message: object }>) {
    await this.notifications.sendSlackNotification(job.data.webhookUrl, job.data.message);
  }

  private getSubject(templateId: string, data: any): string {
    const subjects: Record<string, string> = {
      'review-complete': `AI Review Complete: ${data.prTitle} — Score ${data.qualityScore}/100`,
      'invitation': `You've been invited to ${data.orgName} on AI Code Review`,
    };
    return subjects[templateId] ?? 'AI Code Review Notification';
  }

  private renderTemplate(templateId: string, data: any): string {
    if (templateId === 'review-complete') {
      return `
        <h2>AI Code Review Complete</h2>
        <p>Hi ${data.userName},</p>
        <p>The review for <strong>${data.prTitle}</strong> in <code>${data.repoName}</code> is complete.</p>
        <p><strong>Quality Score:</strong> ${data.qualityScore}/100</p>
        <p><strong>Issues Found:</strong> ${data.commentsCount}</p>
        <p>${data.summary}</p>
        <p><a href="${data.prUrl}">View Full Review →</a></p>
      `;
    }
    return `<p>You have a new notification from AI Code Review.</p>`;
  }
}
