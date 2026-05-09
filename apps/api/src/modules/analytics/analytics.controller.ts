import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgId } from '../../common/decorators/org-id.decorator';
import { AnalyticsService } from './analytics.service';

@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'analytics', version: '1' })
export class AnalyticsController {
  constructor(private analytics: AnalyticsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Get dashboard statistics' })
  getDashboard(@OrgId() orgId: string) {
    return this.analytics.getDashboardStats(orgId);
  }

  @Get('quality-trend')
  @ApiOperation({ summary: 'Get code quality trend over time' })
  getQualityTrend(@OrgId() orgId: string, @Query('days') days = 30) {
    return this.analytics.getQualityTrend(orgId, +days);
  }

  @Get('repositories/:repoId')
  @ApiOperation({ summary: 'Get per-repository statistics' })
  getRepoStats(@Param('repoId') repoId: string, @OrgId() orgId: string) {
    return this.analytics.getRepositoryStats(repoId, orgId);
  }
}
