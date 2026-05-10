import { Injectable, NotFoundException, ForbiddenException, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../database/prisma.service';
import { QUEUE_NAMES, JOB_NAMES } from '../../queues/queue.constants';
import { AiReviewProcessor, ReviewJobData } from './ai-review.processor';

@Injectable()
export class AiReviewService {
  private readonly logger = new Logger(AiReviewService.name);

  constructor(
    private prisma: PrismaService,
    @Optional() @InjectQueue(QUEUE_NAMES.AI_REVIEW) private reviewQueue: Queue | undefined,
    @Optional() private processor: AiReviewProcessor | undefined,
  ) {}

  async triggerManualReview(prId: string, organizationId: string) {
    const pr = await this.prisma.pullRequest.findFirst({
      where: { id: prId, organizationId },
      include: { repository: { select: { id: true } } },
    });

    if (!pr) throw new NotFoundException('Pull request not found');
    if (pr.reviewStatus === 'RUNNING') {
      throw new ForbiddenException('Review already in progress');
    }

    const job = await this.prisma.reviewJob.create({
      data: { pullRequestId: pr.id, organizationId, status: 'PENDING' },
    });

    await this.prisma.pullRequest.update({
      where: { id: prId },
      data: { reviewStatus: 'PENDING' },
    });

    const jobData: ReviewJobData = {
      reviewJobId: job.id,
      pullRequestId: pr.id,
      repositoryId: pr.repositoryId,
      organizationId,
      prNumber: pr.githubPrNumber,
      headSha: pr.headSha,
    };

    if (this.reviewQueue) {
      // Queue mode (local / non-serverless)
      try {
        await this.reviewQueue.add(JOB_NAMES.PROCESS_PR_REVIEW, jobData, { priority: 2 });
      } catch (err) {
        this.logger.error(`Failed to enqueue review job ${job.id}`, err);
        await this.prisma.reviewJob.update({ where: { id: job.id }, data: { status: 'FAILED' } });
        throw err;
      }
    } else if (this.processor) {
      // Serverless mode — run synchronously, don't await (fire-and-continue)
      // The response returns the jobId immediately; client polls for completion.
      this.processor.executeReview(jobData).catch((err) => {
        this.logger.error(`Serverless review job ${job.id} failed: ${err?.message}`);
      });
    }

    return { reviewJobId: job.id };
  }

  async getReviewJob(jobId: string, organizationId: string) {
    return this.prisma.reviewJob.findFirst({
      where: { id: jobId, organizationId },
      include: {
        reviewComments: {
          orderBy: [{ severity: 'asc' }, { startLine: 'asc' }],
        },
      },
    });
  }

  async getReviewHistory(pullRequestId: string, organizationId: string) {
    const pr = await this.prisma.pullRequest.findFirst({ where: { id: pullRequestId, organizationId } });
    if (!pr) throw new NotFoundException('Pull request not found');

    return this.prisma.reviewJob.findMany({
      where: { pullRequestId },
      include: { _count: { select: { reviewComments: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getComments(
    reviewJobId: string,
    organizationId: string,
    filters?: { severity?: string; category?: string; filePath?: string },
  ) {
    const job = await this.prisma.reviewJob.findFirst({ where: { id: reviewJobId, organizationId } });
    if (!job) throw new NotFoundException('Review job not found');

    return this.prisma.reviewComment.findMany({
      where: {
        reviewJobId,
        ...(filters?.severity && { severity: filters.severity as any }),
        ...(filters?.category && { category: filters.category as any }),
        ...(filters?.filePath && { filePath: { contains: filters.filePath } }),
      },
      orderBy: [{ severity: 'asc' }, { filePath: 'asc' }, { startLine: 'asc' }],
    });
  }

  async submitFeedback(commentId: string, organizationId: string, accepted: boolean, note?: string) {
    const comment = await this.prisma.reviewComment.findFirst({
      where: { id: commentId, reviewJob: { organizationId } },
    });
    if (!comment) throw new NotFoundException('Comment not found');

    return this.prisma.reviewComment.update({
      where: { id: commentId },
      data: { isAccepted: accepted, feedbackNote: note },
    });
  }

  async getQueueStats() {
    if (!this.reviewQueue) {
      return { waiting: 0, active: 0, completed: 0, failed: 0, mode: 'serverless' };
    }
    const [waiting, active, completed, failed] = await Promise.all([
      this.reviewQueue.getWaitingCount(),
      this.reviewQueue.getActiveCount(),
      this.reviewQueue.getCompletedCount(),
      this.reviewQueue.getFailedCount(),
    ]);
    return { waiting, active, completed, failed, mode: 'queue' };
  }
}
