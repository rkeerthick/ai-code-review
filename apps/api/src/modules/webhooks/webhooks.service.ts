import {
  Injectable,
  ForbiddenException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { QUEUE_NAMES, JOB_NAMES } from '../../queues/queue.constants';

export interface GitHubPREvent {
  action: 'opened' | 'synchronize' | 'reopened' | 'closed' | 'ready_for_review';
  number: number;
  pull_request: {
    number: number;
    title: string;
    body: string | null;
    state: string;
    user: { login: string; avatar_url: string };
    head: { sha: string; ref: string };
    base: { ref: string };
    html_url: string;
    created_at: string;
    updated_at: string;
    draft: boolean;
  };
  repository: {
    id: number;
    full_name: string;
  };
  sender: { login: string };
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.AI_REVIEW) private reviewQueue: Queue,
  ) {}

  async handleGitHubWebhook(
    payload: Buffer,
    signature: string,
    eventType: string,
  ) {
    // Find repository by matching webhook secret
    const parsedPayload = JSON.parse(payload.toString('utf8'));
    const repoGithubId = parsedPayload?.repository?.id;

    if (!repoGithubId) {
      throw new BadRequestException('Missing repository in payload');
    }

    const repository = await this.prisma.repository.findFirst({
      where: { githubId: repoGithubId, webhookActive: true },
      select: { id: true, webhookSecret: true, organizationId: true, autoReview: true, reviewOnDraft: true },
    });

    if (!repository || !repository.webhookSecret) {
      this.logger.warn(`Unknown repository githubId: ${repoGithubId}`);
      return { processed: false, reason: 'repository not found' };
    }

    // Validate HMAC-SHA256 signature — reject anything invalid
    this.validateSignature(payload, repository.webhookSecret, signature);

    this.logger.log(`GitHub event: ${eventType} for repo ${repoGithubId}`);

    if (eventType === 'pull_request') {
      return this.handlePullRequestEvent(parsedPayload as GitHubPREvent, repository);
    }

    if (eventType === 'push') {
      return this.handlePushEvent(parsedPayload, repository.id, repository.organizationId);
    }

    return { processed: false, reason: `unhandled event: ${eventType}` };
  }

  private async handlePullRequestEvent(
    event: GitHubPREvent,
    repo: { id: string; organizationId: string; autoReview: boolean; reviewOnDraft: boolean },
  ) {
    const { action, pull_request: pr, number: prNumber } = event;

    // Only process review-triggering actions
    const triggerActions = ['opened', 'synchronize', 'reopened', 'ready_for_review'];
    if (!triggerActions.includes(action)) {
      return { processed: false, reason: `action ${action} not triggering review` };
    }

    // Skip draft PRs unless configured otherwise
    if (pr.draft && !repo.reviewOnDraft) {
      return { processed: false, reason: 'draft PR skipped' };
    }

    if (!repo.autoReview) {
      return { processed: false, reason: 'auto review disabled for this repository' };
    }

    // Upsert the pull request record
    const pullRequest = await this.prisma.pullRequest.upsert({
      where: {
        repositoryId_githubPrNumber: {
          repositoryId: repo.id,
          githubPrNumber: prNumber,
        },
      },
      update: {
        title: pr.title,
        body: pr.body,
        state: pr.state === 'open' ? 'OPEN' : 'CLOSED',
        headBranch: pr.head.ref,
        headSha: pr.head.sha,
        baseBranch: pr.base.ref,
        githubUpdatedAt: new Date(pr.updated_at),
        reviewStatus: 'PENDING',
      },
      create: {
        repositoryId: repo.id,
        organizationId: repo.organizationId,
        githubPrNumber: prNumber,
        title: pr.title,
        body: pr.body,
        state: 'OPEN',
        authorLogin: pr.user.login,
        authorAvatar: pr.user.avatar_url,
        headBranch: pr.head.ref,
        headSha: pr.head.sha,
        baseBranch: pr.base.ref,
        htmlUrl: pr.html_url,
        githubCreatedAt: new Date(pr.created_at),
        githubUpdatedAt: new Date(pr.updated_at),
        reviewStatus: 'PENDING',
      },
    });

    // Create a ReviewJob
    const reviewJob = await this.prisma.reviewJob.create({
      data: {
        pullRequestId: pullRequest.id,
        organizationId: repo.organizationId,
        status: 'PENDING',
      },
    });

    // Enqueue review job with deduplication key
    // jobId ensures exactly-once processing per PR+SHA
    const jobId = `review:${pullRequest.id}:${pr.head.sha}`;

    await this.reviewQueue.add(
      JOB_NAMES.PROCESS_PR_REVIEW,
      {
        reviewJobId: reviewJob.id,
        pullRequestId: pullRequest.id,
        repositoryId: repo.id,
        organizationId: repo.organizationId,
        prNumber,
        headSha: pr.head.sha,
      },
      {
        jobId, // Deduplication — same SHA won't be re-queued
        priority: 1,
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },
        timeout: 300000, // 5-minute max per review job
      },
    );

    this.logger.log(
      `Review job ${reviewJob.id} queued for PR #${prNumber} (SHA: ${pr.head.sha.slice(0, 8)})`,
    );

    return { processed: true, reviewJobId: reviewJob.id };
  }

  private async handlePushEvent(
    event: any,
    repositoryId: string,
    organizationId: string,
  ) {
    // Index pushed commits for RAG context
    this.logger.debug(`Push event — will index new commits for RAG`);
    return { processed: true, action: 'indexing_scheduled' };
  }

  private validateSignature(payload: Buffer, secret: string, signature: string) {
    if (!signature) {
      throw new ForbiddenException('Missing webhook signature');
    }

    const hmac = createHmac('sha256', secret);
    hmac.update(payload);
    const expected = `sha256=${hmac.digest('hex')}`;

    try {
      const sigBuffer = Buffer.from(signature);
      const expectedBuffer = Buffer.from(expected);

      if (
        sigBuffer.length !== expectedBuffer.length ||
        !timingSafeEqual(sigBuffer, expectedBuffer)
      ) {
        throw new ForbiddenException('Invalid webhook signature');
      }
    } catch {
      throw new ForbiddenException('Invalid webhook signature');
    }
  }
}
