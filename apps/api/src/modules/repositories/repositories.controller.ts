import {
  Controller, Get, Post, Delete, Patch, Param,
  Body, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, IsArray, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgId } from '../../common/decorators/org-id.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RepositoriesService } from './repositories.service';

class ImportRepositoryDto {
  @ApiProperty() @IsNumber() githubId: number;
}

class UpdateSettingsDto {
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() autoReview?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() reviewOnDraft?: boolean;
  @ApiProperty({ required: false, type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) ignoredPaths?: string[];
}

@ApiTags('repositories')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'repositories', version: '1' })
export class RepositoriesController {
  constructor(private repos: RepositoriesService) {}

  @Post()
  @ApiOperation({ summary: 'Import a GitHub repository' })
  import(
    @OrgId() orgId: string,
    @CurrentUser() user: any,
    @Body() dto: ImportRepositoryDto,
  ) {
    return this.repos.importRepository(dto.githubId, orgId, user.id);
  }

  @Get()
  @ApiOperation({ summary: 'List organization repositories' })
  list(
    @OrgId() orgId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.repos.listRepositories(orgId, +page, +limit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get repository details' })
  get(@Param('id') id: string, @OrgId() orgId: string) {
    return this.repos.getRepository(id, orgId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove repository from platform' })
  remove(@Param('id') id: string, @OrgId() orgId: string) {
    return this.repos.removeRepository(id, orgId);
  }

  @Post(':id/sync-prs')
  @ApiOperation({ summary: 'Sync pull requests from GitHub' })
  syncPRs(@Param('id') id: string, @OrgId() orgId: string) {
    return this.repos.syncPullRequests(id, orgId);
  }

  @Patch(':id/settings')
  @ApiOperation({ summary: 'Update repository review settings' })
  updateSettings(
    @Param('id') id: string,
    @OrgId() orgId: string,
    @Body() dto: UpdateSettingsDto,
  ) {
    return this.repos.updateSettings(id, orgId, dto);
  }
}
