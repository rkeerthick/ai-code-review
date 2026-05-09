import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  Patch,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgId } from '../../common/decorators/org-id.decorator';
import { AiReviewService } from './ai-review.service';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

class FeedbackDto {
  @ApiProperty()
  @IsBoolean()
  accepted: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

@ApiTags('ai-review')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'reviews', version: '1' })
export class AiReviewController {
  constructor(private aiReview: AiReviewService) {}

  @Post('pull-requests/:prId/trigger')
  @ApiOperation({ summary: 'Manually trigger AI review for a pull request' })
  triggerReview(
    @Param('prId') prId: string,
    @OrgId() orgId: string,
  ) {
    return this.aiReview.triggerManualReview(prId, orgId);
  }

  @Get('jobs/:jobId')
  @ApiOperation({ summary: 'Get review job status and comments' })
  getJob(@Param('jobId') jobId: string, @OrgId() orgId: string) {
    return this.aiReview.getReviewJob(jobId, orgId);
  }

  @Get('jobs/:jobId/comments')
  @ApiOperation({ summary: 'Get review comments with optional filters' })
  getComments(
    @Param('jobId') jobId: string,
    @OrgId() orgId: string,
    @Query('severity') severity?: string,
    @Query('category') category?: string,
    @Query('file') filePath?: string,
  ) {
    return this.aiReview.getComments(jobId, orgId, { severity, category, filePath });
  }

  @Get('pull-requests/:prId/history')
  @ApiOperation({ summary: 'Get review history for a pull request' })
  getHistory(@Param('prId') prId: string, @OrgId() orgId: string) {
    return this.aiReview.getReviewHistory(prId, orgId);
  }

  @Patch('comments/:commentId/feedback')
  @ApiOperation({ summary: 'Submit feedback on a review comment' })
  submitFeedback(
    @Param('commentId') commentId: string,
    @OrgId() orgId: string,
    @Body() dto: FeedbackDto,
  ) {
    return this.aiReview.submitFeedback(commentId, orgId, dto.accepted, dto.note);
  }

  @Get('queue/stats')
  @ApiOperation({ summary: 'Get review queue statistics' })
  getQueueStats() {
    return this.aiReview.getQueueStats();
  }
}
