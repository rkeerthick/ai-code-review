import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { GitHubService } from '../github/github.service';

@Injectable()
export class PullRequestsService {
  constructor(
    private prisma: PrismaService,
    private github: GitHubService,
  ) {}

  async list(
    organizationId: string,
    filters?: { repositoryId?: string; state?: string; reviewStatus?: string },
    page = 1,
    limit = 20,
  ) {
    const where: any = { organizationId };
    if (filters?.repositoryId) where.repositoryId = filters.repositoryId;
    if (filters?.state) where.state = filters.state;
    if (filters?.reviewStatus) where.reviewStatus = filters.reviewStatus;

    const [data, total] = await Promise.all([
      this.prisma.pullRequest.findMany({
        where,
        include: {
          repository: { select: { fullName: true, name: true } },
          reviewJobs: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { id: true, status: true, completedAt: true },
          },
        },
        orderBy: { githubUpdatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.pullRequest.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findById(id: string, organizationId: string) {
    const pr = await this.prisma.pullRequest.findFirst({
      where: { id, organizationId },
      include: {
        repository: { select: { id: true, fullName: true, name: true, htmlUrl: true } },
        reviewJobs: {
          orderBy: { createdAt: 'desc' },
          include: {
            reviewComments: {
              orderBy: [{ severity: 'asc' }, { startLine: 'asc' }],
            },
            _count: { select: { reviewComments: true } },
          },
        },
      },
    });
    if (!pr) throw new NotFoundException('Pull request not found');
    return pr;
  }

  async mergePR(
    id: string,
    organizationId: string,
    method: 'merge' | 'squash' | 'rebase' = 'merge',
  ) {
    const pr = await this.prisma.pullRequest.findFirst({
      where: { id, organizationId },
      include: { repository: { select: { id: true } } },
    });
    if (!pr) throw new NotFoundException('Pull request not found');
    if (pr.state !== 'OPEN') throw new BadRequestException('Only open pull requests can be merged');

    const result = await this.github.mergePullRequest(pr.repositoryId, pr.githubPrNumber, method);

    await this.prisma.pullRequest.update({
      where: { id },
      data: { state: 'MERGED', githubUpdatedAt: new Date() },
    });

    return result;
  }

  async closePR(id: string, organizationId: string) {
    const pr = await this.prisma.pullRequest.findFirst({
      where: { id, organizationId },
    });
    if (!pr) throw new NotFoundException('Pull request not found');
    if (pr.state !== 'OPEN') throw new BadRequestException('Pull request is not open');

    await this.github.updatePullRequestState(pr.repositoryId, pr.githubPrNumber, 'closed');

    return this.prisma.pullRequest.update({
      where: { id },
      data: { state: 'CLOSED', githubUpdatedAt: new Date() },
    });
  }

  async reopenPR(id: string, organizationId: string) {
    const pr = await this.prisma.pullRequest.findFirst({
      where: { id, organizationId },
    });
    if (!pr) throw new NotFoundException('Pull request not found');
    if (pr.state !== 'CLOSED') throw new BadRequestException('Only closed pull requests can be reopened');

    await this.github.updatePullRequestState(pr.repositoryId, pr.githubPrNumber, 'open');

    return this.prisma.pullRequest.update({
      where: { id },
      data: { state: 'OPEN', githubUpdatedAt: new Date() },
    });
  }

  async getComments(id: string, organizationId: string) {
    const pr = await this.prisma.pullRequest.findFirst({
      where: { id, organizationId },
    });
    if (!pr) throw new NotFoundException('Pull request not found');

    return this.github.getPRConversation(pr.repositoryId, pr.githubPrNumber);
  }

  async addComment(id: string, organizationId: string, body: string) {
    const pr = await this.prisma.pullRequest.findFirst({
      where: { id, organizationId },
    });
    if (!pr) throw new NotFoundException('Pull request not found');

    return this.github.addPRComment(pr.repositoryId, pr.githubPrNumber, body);
  }

  async getDiff(id: string, organizationId: string) {
    const pr = await this.prisma.pullRequest.findFirst({
      where: { id, organizationId },
    });
    if (!pr) throw new NotFoundException('Pull request not found');

    const diff = await this.github.getPullRequestDiff(pr.repositoryId, pr.githubPrNumber);
    return {
      prNumber: diff.prNumber,
      headSha: diff.headSha,
      files: diff.files.map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch,
        language: f.language,
      })),
    };
  }

  async getLineComments(id: string, organizationId: string) {
    const pr = await this.prisma.pullRequest.findFirst({
      where: { id, organizationId },
    });
    if (!pr) throw new NotFoundException('Pull request not found');

    return this.github.getLineComments(pr.repositoryId, pr.githubPrNumber);
  }

  async addLineComment(
    id: string,
    organizationId: string,
    filePath: string,
    line: number,
    side: 'LEFT' | 'RIGHT',
    body: string,
  ) {
    const pr = await this.prisma.pullRequest.findFirst({
      where: { id, organizationId },
    });
    if (!pr) throw new NotFoundException('Pull request not found');

    return this.github.postReviewComment(pr.repositoryId, pr.githubPrNumber, {
      body,
      path: filePath,
      line,
      side,
    });
  }
}
