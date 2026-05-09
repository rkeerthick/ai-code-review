import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { AiReviewController } from './ai-review.controller';
import { AiReviewService } from './ai-review.service';
import { AiReviewProcessor } from './ai-review.processor';
import { ReviewGateway } from './review.gateway';
import { DiffParserService } from './engines/diff-parser.service';
import { PromptBuilderService } from './engines/prompt-builder.service';
import { CodeAnalyzerService } from './engines/code-analyzer.service';
import { EmbeddingService } from './rag/embedding.service';
import { VectorStoreService } from './rag/vector-store.service';
import { GitHubModule } from '../github/github.module';
import { AuthModule } from '../auth/auth.module';
import { QUEUE_NAMES } from '../../queues/queue.constants';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAMES.AI_REVIEW }),
    GitHubModule,
    AuthModule,
  ],
  controllers: [AiReviewController],
  providers: [
    AiReviewService,
    AiReviewProcessor,
    ReviewGateway,
    DiffParserService,
    PromptBuilderService,
    CodeAnalyzerService,
    EmbeddingService,
    VectorStoreService,
  ],
  exports: [AiReviewService],
})
export class AiReviewModule {}
