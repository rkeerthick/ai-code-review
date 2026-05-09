import { Controller, Get, Post, Param, Query, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsString, IsIn, IsOptional, MaxLength, MinLength, IsNumber, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgId } from '../../common/decorators/org-id.decorator';
import { PullRequestsService } from './pull-requests.service';

class MergeDto {
  @ApiProperty({ enum: ['merge', 'squash', 'rebase'], default: 'merge' })
  @IsIn(['merge', 'squash', 'rebase'])
  method: 'merge' | 'squash' | 'rebase' = 'merge';
}

class AddCommentDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(65536)
  body: string;
}

class AddLineCommentDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  filePath: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  line: number;

  @ApiProperty({ enum: ['LEFT', 'RIGHT'], default: 'RIGHT' })
  @IsIn(['LEFT', 'RIGHT'])
  side: 'LEFT' | 'RIGHT' = 'RIGHT';

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(65536)
  body: string;
}

@ApiTags('pull-requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'pull-requests', version: '1' })
export class PullRequestsController {
  constructor(private prs: PullRequestsService) {}

  @Get()
  @ApiOperation({ summary: 'List pull requests' })
  list(
    @OrgId() orgId: string,
    @Query('repositoryId') repositoryId?: string,
    @Query('state') state?: string,
    @Query('reviewStatus') reviewStatus?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.prs.list(orgId, { repositoryId, state, reviewStatus }, +page, +limit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get pull request with reviews' })
  get(@Param('id') id: string, @OrgId() orgId: string) {
    return this.prs.findById(id, orgId);
  }

  @Post(':id/merge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Merge pull request' })
  merge(@Param('id') id: string, @OrgId() orgId: string, @Body() dto: MergeDto) {
    return this.prs.mergePR(id, orgId, dto.method);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close pull request' })
  close(@Param('id') id: string, @OrgId() orgId: string) {
    return this.prs.closePR(id, orgId);
  }

  @Post(':id/reopen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reopen pull request' })
  reopen(@Param('id') id: string, @OrgId() orgId: string) {
    return this.prs.reopenPR(id, orgId);
  }

  @Get(':id/comments')
  @ApiOperation({ summary: 'Get PR conversation comments from GitHub' })
  getComments(@Param('id') id: string, @OrgId() orgId: string) {
    return this.prs.getComments(id, orgId);
  }

  @Post(':id/comments')
  @ApiOperation({ summary: 'Add a comment to the PR on GitHub' })
  addComment(
    @Param('id') id: string,
    @OrgId() orgId: string,
    @Body() dto: AddCommentDto,
  ) {
    return this.prs.addComment(id, orgId, dto.body);
  }

  @Get(':id/diff')
  @ApiOperation({ summary: 'Get PR file diff' })
  getDiff(@Param('id') id: string, @OrgId() orgId: string) {
    return this.prs.getDiff(id, orgId);
  }

  @Get(':id/line-comments')
  @ApiOperation({ summary: 'Get inline review comments on the PR' })
  getLineComments(@Param('id') id: string, @OrgId() orgId: string) {
    return this.prs.getLineComments(id, orgId);
  }

  @Post(':id/line-comments')
  @ApiOperation({ summary: 'Add an inline comment on a specific line' })
  addLineComment(
    @Param('id') id: string,
    @OrgId() orgId: string,
    @Body() dto: AddLineCommentDto,
  ) {
    return this.prs.addLineComment(id, orgId, dto.filePath, dto.line, dto.side, dto.body);
  }
}
