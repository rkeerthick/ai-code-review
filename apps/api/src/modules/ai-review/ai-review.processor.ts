import { Process, Processor, OnQueueFailed, OnQueueCompleted } from '@nestjs/bull';
import { Job } from 'bull';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHash } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { GitHubService } from '../github/github.service';
import { DiffParserService } from './engines/diff-parser.service';
import { CodeAnalyzerService } from './engines/code-analyzer.service';
import { VectorStoreService } from './rag/vector-store.service';
import { QUEUE_NAMES, JOB_NAMES } from '../../queues/queue.constants';

export interface ReviewJobData {
  reviewJobId: string;
  pullRequestId: string;
  repositoryId: string;
  organizationId: string;
  prNumber: number;
  headSha: string;
}

@Injectable()
@Processor(QUEUE_NAMES.AI_REVIEW)
export class AiReviewProcessor {
  private readonly logger = new Logger(AiReviewProcessor.name);

  constructor(
    private prisma: PrismaService,
    private github: GitHubService,
    private diffParser: DiffParserService,
    private analyzer: CodeAnalyzerService,
    private vectorStore: VectorStoreService,
    private eventEmitter: EventEmitter2,
  ) {}

  @Process(JOB_NAMES.PROCESS_PR_REVIEW)
  async processReview(job: Job<ReviewJobData>) {
    await this.executeReview(job.data, async (pct: number) => job.progress(pct));
  }

  /** Direct execution — used in serverless mode (no Bull queue). */
  async executeReview(data: ReviewJobData, onProgress?: (pct: number) => Promise<void>) {
    const { reviewJobId, pullRequestId, repositoryId, organizationId, prNumber, headSha } = data;
    const startTime = Date.now();

    this.logger.log(`Processing review job ${reviewJobId} for PR #${prNumber}`);

    await this.prisma.reviewJob.update({
      where: { id: reviewJobId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });

    await this.emit('review.started', { reviewJobId, pullRequestId });

    try {
      const diffCacheKey = this.buildCacheKey(repositoryId, prNumber, headSha);
      const cachedReview = await this.checkReviewCache(diffCacheKey);

      if (cachedReview) {
        this.logger.log(`Cache hit for review job ${reviewJobId}`);
        await this.storeResults(reviewJobId, pullRequestId, cachedReview, { isCached: true, durationMs: Date.now() - startTime, cacheKey: diffCacheKey });
        return;
      }

      await onProgress?.(15);
      const prDiff = await this.github.getPullRequestDiff(repositoryId, prNumber);

      if (prDiff.files.length === 0) {
        this.logger.warn(`No reviewable files in PR #${prNumber}`);
        await this.completeJobEmpty(reviewJobId, pullRequestId, 'No reviewable files in this PR');
        return;
      }

      await onProgress?.(25);
      const parsedFiles = this.diffParser.parseDiff(prDiff.files);
      const chunks = this.diffParser.splitIntoChunks(parsedFiles);
      this.logger.debug(`Split into ${chunks.length} review chunks`);

      await onProgress?.(35);
      let ragContext: string | undefined;
      try {
        const searchQuery = chunks.slice(0, 3).map((c) => c.content.slice(0, 200)).join('\n');
        const similarCode = await this.vectorStore.searchSimilar(searchQuery, organizationId, 5);
        ragContext = this.vectorStore.formatContextForPrompt(similarCode);
      } catch {
        this.logger.warn('RAG context retrieval failed — proceeding without context');
      }

      await onProgress?.(50);
      this.logger.log(`Running AI analysis on ${chunks.length} chunks for PR #${prNumber}`);

      const reviewResult = await this.analyzer.analyzeMultipleChunks(chunks, prDiff.title, ragContext);

      await onProgress?.(80);

      const criticalOrHighComments = reviewResult.comments.filter(
        (c) => c.severity === 'CRITICAL' || c.severity === 'HIGH',
      );

      for (const comment of criticalOrHighComments.slice(0, 20)) {
        try {
          await this.github.postReviewComment(repositoryId, prNumber, {
            body: this.formatGitHubComment(comment),
            path: comment.filePath,
            line: comment.startLine,
          });
        } catch (err) {
          this.logger.warn(`Failed to post comment on ${comment.filePath}:${comment.startLine}: ${err}`);
        }
      }

      if (reviewResult.comments.length > 0) {
        try {
          await this.github.submitPRReview(repositoryId, prNumber, this.buildGitHubSummary(reviewResult), 'COMMENT');
        } catch (err) {
          this.logger.warn(`Could not post GitHub review summary (PR may be merged): ${err}`);
        }
      }

      await onProgress?.(90);

      const durationMs = Date.now() - startTime;
      await this.storeResults(reviewJobId, pullRequestId, reviewResult, {
        durationMs,
        filesReviewed: parsedFiles.length,
        cacheKey: diffCacheKey,
      });

      await this.cacheReviewResult(diffCacheKey, reviewResult);

      await onProgress?.(100);
      this.logger.log(
        `Review job ${reviewJobId} completed: ${reviewResult.comments.length} issues, score=${reviewResult.qualityScore}, ${durationMs}ms`,
      );
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Review job ${reviewJobId} failed: ${errMsg}`, (error as Error)?.stack);

      await this.prisma.reviewJob.update({
        where: { id: reviewJobId },
        data: { status: 'FAILED', errorMessage: errMsg.slice(0, 1000) },
      });

      await this.prisma.pullRequest.update({
        where: { id: pullRequestId },
        data: { reviewStatus: 'FAILED' },
      });

      await this.emit('review.failed', { reviewJobId, pullRequestId, error: errMsg });
      throw error;
    }
  }

  @OnQueueFailed()
  async onJobFailed(job: Job<ReviewJobData>, err: Error) {
    this.logger.error(`Job ${job.id} failed after ${job.attemptsMade} attempts: ${err.message}`);
  }

  @OnQueueCompleted()
  async onJobCompleted(job: Job<ReviewJobData>) {
    this.logger.debug(`Job ${job.id} completed successfully`);
  }

  private async storeResults(
    reviewJobId: string,
    pullRequestId: string,
    result: any,
    meta: { durationMs?: number; filesReviewed?: number; isCached?: boolean; cacheKey?: string },
  ) {
    await this.prisma.$transaction(async (tx) => {
      if (result.comments.length > 0) {
        await tx.reviewComment.createMany({
          data: result.comments.map((c: any) => ({
            reviewJobId,
            severity: c.severity,
            category: c.category,
            filePath: c.filePath,
            startLine: c.startLine,
            endLine: c.endLine ?? c.startLine,
            issue: c.issue,
            suggestion: c.suggestion,
            codeExample: c.codeExample,
            confidence: c.confidence,
          })),
        });
      }

      await tx.reviewJob.update({
        where: { id: reviewJobId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          tokensUsed: result.tokensUsed,
          durationMs: meta.durationMs,
          filesReviewed: meta.filesReviewed,
          isCached: meta.isCached ?? false,
          cacheKey: meta.cacheKey,
          modelUsed: result.modelUsed,
        },
      });

      await tx.pullRequest.update({
        where: { id: pullRequestId },
        data: { reviewStatus: 'COMPLETED', qualityScore: result.qualityScore },
      });
    });

    await this.emit('review.completed', {
      reviewJobId,
      pullRequestId,
      commentsCount: result.comments.length,
      qualityScore: result.qualityScore,
      summary: result.summary,
    });
  }

  private async completeJobEmpty(reviewJobId: string, pullRequestId: string, reason: string) {
    await this.prisma.reviewJob.update({
      where: { id: reviewJobId },
      data: { status: 'COMPLETED', completedAt: new Date(), errorMessage: reason },
    });
    await this.prisma.pullRequest.update({
      where: { id: pullRequestId },
      data: { reviewStatus: 'COMPLETED', qualityScore: 100 },
    });
    await this.emit('review.completed', { reviewJobId, pullRequestId, commentsCount: 0, qualityScore: 100 });
  }

  private buildCacheKey(repoId: string, prNumber: number, headSha: string): string {
    return createHash('sha256').update(`${repoId}:${prNumber}:${headSha}`).digest('hex').slice(0, 32);
  }

  private async checkReviewCache(_key: string): Promise<any | null> {
    return null;
  }

  private async cacheReviewResult(_key: string, _result: any): Promise<void> {}

  private formatGitHubComment(comment: any): string {
    const severityEmoji: Record<string, string> = {
      CRITICAL: '🚨', HIGH: '⚠️', MEDIUM: '💡', LOW: '📝', INFO: 'ℹ️',
    };
    const emoji = severityEmoji[comment.severity] ?? '💬';
    return [
      `${emoji} **[${comment.severity}] ${comment.category}**`,
      '',
      comment.issue,
      '',
      `**Suggestion:** ${comment.suggestion}`,
      comment.codeExample ? `\n\`\`\`\n${comment.codeExample}\n\`\`\`` : '',
      '',
      '*Reviewed by [AI Code Review](https://aicodereview.io)*',
    ].filter(Boolean).join('\n');
  }

  private buildGitHubSummary(result: any): string {
    const critical = result.comments.filter((c: any) => c.severity === 'CRITICAL').length;
    const high = result.comments.filter((c: any) => c.severity === 'HIGH').length;
    const medium = result.comments.filter((c: any) => c.severity === 'MEDIUM').length;
    return [
      `## 🤖 AI Code Review Summary`,
      '',
      `**Quality Score:** ${result.qualityScore}/100`,
      '',
      result.summary,
      '',
      '**Issues Found:**',
      `- 🚨 Critical: ${critical}`,
      `- ⚠️ High: ${high}`,
      `- 💡 Medium: ${medium}`,
      `- 📝 Total: ${result.comments.length}`,
      '',
      '*Powered by [AI Code Review](https://aicodereview.io)*',
    ].join('\n');
  }

  private async emit(event: string, data: any) {
    this.eventEmitter.emit(event, data);
  }
}
