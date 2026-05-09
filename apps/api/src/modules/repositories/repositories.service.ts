import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { GitHubService } from '../github/github.service';
import { QUEUE_NAMES, JOB_NAMES } from '../../queues/queue.constants';

@Injectable()
export class RepositoriesService {
  private readonly logger = new Logger(RepositoriesService.name);

  constructor(
    private prisma: PrismaService,
    private github: GitHubService,
    private config: ConfigService,
    @InjectQueue(QUEUE_NAMES.EMBEDDINGS) private embeddingsQueue: Queue,
  ) {}

  async importRepository(
    githubId: number,
    organizationId: string,
    userId: string,
  ) {
    const existing = await this.prisma.repository.findFirst({
      where: { githubId, organizationId },
    });
    if (existing) throw new ConflictException('Repository already imported');

    // Verify org limits
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      include: { _count: { select: { repositories: { where: { deletedAt: null } } } } },
    });

    if (org.maxRepositories !== -1 && (org as any)._count.repositories >= org.maxRepositories) {
      throw new ForbiddenException(`Plan limit reached: max ${org.maxRepositories} repositories`);
    }

    // Fetch repo info from GitHub
    const repos = await this.github.listUserRepositories(userId);
    const repoInfo = repos.find((r) => r.githubId === githubId);
    if (!repoInfo) throw new NotFoundException('Repository not found in GitHub account');

    // Generate webhook secret
    const webhookSecret = randomBytes(32).toString('hex');

    const repository = await this.prisma.repository.create({
      data: {
        organizationId,
        githubId: repoInfo.githubId,
        fullName: repoInfo.fullName,
        name: repoInfo.name,
        ownerLogin: repoInfo.ownerLogin,
        isPrivate: repoInfo.isPrivate,
        description: repoInfo.description,
        defaultBranch: repoInfo.defaultBranch,
        language: repoInfo.language,
        htmlUrl: repoInfo.htmlUrl,
        cloneUrl: repoInfo.cloneUrl ?? null,
        webhookSecret,
      },
    });

    // Register GitHub webhook
    try {
      const apiUrl = this.config.getOrThrow('API_URL');
      const webhookId = await this.github.registerWebhook(
        repository.id,
        `${apiUrl}/api/v1/webhooks/github`,
        webhookSecret,
      );
      await this.prisma.repository.update({
        where: { id: repository.id },
        data: { webhookId, webhookActive: true },
      });
    } catch (err) {
      this.logger.error(`Failed to register webhook for ${repoInfo.fullName}`, err);
    }

    // Queue repository indexing for RAG
    try {
      await this.embeddingsQueue.add(JOB_NAMES.INDEX_REPOSITORY, {
        repositoryId: repository.id,
        organizationId,
      }, { priority: 3, delay: 5000 });
    } catch (err) {
      this.logger.warn(`Could not queue indexing job for ${repoInfo.fullName}`, err);
    }

    return repository;
  }

  async listRepositories(organizationId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [repos, total] = await Promise.all([
      this.prisma.repository.findMany({
        where: { organizationId, deletedAt: null },
        include: {
          _count: { select: { pullRequests: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.repository.count({ where: { organizationId, deletedAt: null } }),
    ]);
    return { data: repos, total, page, limit };
  }

  async getRepository(id: string, organizationId: string) {
    const repo = await this.prisma.repository.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: {
        _count: { select: { pullRequests: true } },
      },
    });
    if (!repo) throw new NotFoundException('Repository not found');
    return repo;
  }

  async removeRepository(id: string, organizationId: string) {
    const repo = await this.prisma.repository.findFirst({
      where: { id, organizationId },
    });
    if (!repo) throw new NotFoundException('Repository not found');

    // Remove GitHub webhook
    if (repo.webhookId) {
      try {
        await this.github.removeWebhook(id, repo.webhookId);
      } catch {
        this.logger.warn(`Could not remove webhook ${repo.webhookId} from GitHub`);
      }
    }

    // Soft delete
    await this.prisma.repository.update({
      where: { id },
      data: { deletedAt: new Date(), webhookActive: false },
    });
  }

  async syncPullRequests(repoId: string, organizationId: string) {
    const repo = await this.prisma.repository.findFirst({
      where: { id: repoId, organizationId, deletedAt: null },
    });
    if (!repo) throw new NotFoundException('Repository not found');

    const prs = await this.github.listRepoPullRequests(repoId, 'all');

    let created = 0;
    let updated = 0;

    for (const pr of prs) {
      const existing = await this.prisma.pullRequest.findUnique({
        where: { repositoryId_githubPrNumber: { repositoryId: repoId, githubPrNumber: pr.githubPrNumber } },
      });

      if (existing) {
        await this.prisma.pullRequest.update({
          where: { id: existing.id },
          data: {
            title: pr.title,
            state: pr.state,
            headSha: pr.headSha,
            githubUpdatedAt: pr.githubUpdatedAt,
          },
        });
        updated++;
      } else {
        await this.prisma.pullRequest.create({
          data: {
            organizationId,
            repositoryId: repoId,
            ...pr,
            reviewStatus: 'PENDING',
          },
        });
        created++;
      }
    }

    return { synced: prs.length, created, updated };
  }

  async updateSettings(
    id: string,
    organizationId: string,
    settings: {
      autoReview?: boolean;
      reviewOnDraft?: boolean;
      ignoredPaths?: string[];
    },
  ) {
    await this.getRepository(id, organizationId);
    return this.prisma.repository.update({
      where: { id },
      data: settings,
    });
  }
}
