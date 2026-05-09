import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  async getDashboardStats(organizationId: string) {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const month = parseInt(`${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`);

    const [
      totalRepos,
      totalPRs,
      reviewsThisMonth,
      openPRs,
      avgScore,
      issuesByCategory,
      issuesBySeverity,
      usageThisMonth,
      recentReviews,
    ] = await Promise.all([
      this.prisma.repository.count({ where: { organizationId, deletedAt: null } }),
      this.prisma.pullRequest.count({ where: { organizationId } }),
      this.prisma.reviewJob.count({
        where: { organizationId, status: 'COMPLETED', createdAt: { gte: thirtyDaysAgo } },
      }),
      this.prisma.pullRequest.count({ where: { organizationId, state: 'OPEN' } }),
      this.prisma.pullRequest.aggregate({
        where: { organizationId, qualityScore: { not: null } },
        _avg: { qualityScore: true },
      }),
      this.prisma.reviewComment.groupBy({
        by: ['category'],
        where: { reviewJob: { organizationId, createdAt: { gte: thirtyDaysAgo } } },
        _count: { _all: true },
        orderBy: { _count: { id: 'desc' } },
      }),
      this.prisma.reviewComment.groupBy({
        by: ['severity'],
        where: { reviewJob: { organizationId, createdAt: { gte: thirtyDaysAgo } } },
        _count: { _all: true },
      }),
      this.prisma.usageMetric.findUnique({
        where: { organizationId_month: { organizationId, month } },
      }),
      this.prisma.reviewJob.findMany({
        where: { organizationId, status: 'COMPLETED' },
        include: {
          pullRequest: {
            select: {
              githubPrNumber: true,
              title: true,
              qualityScore: true,
              repository: { select: { fullName: true } },
            },
          },
          _count: { select: { reviewComments: true } },
        },
        orderBy: { completedAt: 'desc' },
        take: 10,
      }),
    ]);

    return {
      overview: {
        totalRepositories: totalRepos,
        totalPullRequests: totalPRs,
        reviewsThisMonth,
        openPullRequests: openPRs,
        averageQualityScore: Math.round(avgScore._avg.qualityScore ?? 0),
      },
      usage: {
        reviewsUsed: usageThisMonth?.reviewsCount ?? 0,
        tokensUsed: usageThisMonth?.tokensUsed ?? 0,
        estimatedCost: usageThisMonth?.costUsd ?? 0,
      },
      issuesByCategory: issuesByCategory.map((g) => ({
        category: g.category,
        count: (g._count as any)._all,
      })),
      issuesBySeverity: issuesBySeverity.map((g) => ({
        severity: g.severity,
        count: (g._count as any)._all,
      })),
      recentReviews,
    };
  }

  async getQualityTrend(organizationId: string, days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    return this.prisma.pullRequest.findMany({
      where: {
        organizationId,
        reviewStatus: 'COMPLETED',
        updatedAt: { gte: since },
        qualityScore: { not: null },
      },
      select: {
        qualityScore: true,
        updatedAt: true,
        repository: { select: { name: true } },
      },
      orderBy: { updatedAt: 'asc' },
    });
  }

  async getRepositoryStats(repositoryId: string, organizationId: string) {
    const [prStats, recentIssues, avgScore] = await Promise.all([
      this.prisma.pullRequest.groupBy({
        by: ['state'],
        where: { repositoryId, organizationId },
        _count: { _all: true },
      }),
      this.prisma.reviewComment.groupBy({
        by: ['category', 'severity'],
        where: { reviewJob: { pullRequest: { repositoryId } } },
        _count: { _all: true },
        orderBy: { _count: { id: 'desc' } },
        take: 20,
      }),
      this.prisma.pullRequest.aggregate({
        where: { repositoryId, qualityScore: { not: null } },
        _avg: { qualityScore: true },
      }),
    ]);

    return { prStats, recentIssues, averageQualityScore: avgScore._avg.qualityScore };
  }
}
