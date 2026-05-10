import { Module } from '@nestjs/common';
import { AiReviewController } from './ai-review.controller';
import { AiReviewService } from './ai-review.service';
import { AiReviewProcessor } from './ai-review.processor';
import { DiffParserService } from './engines/diff-parser.service';
import { PromptBuilderService } from './engines/prompt-builder.service';
import { CodeAnalyzerService } from './engines/code-analyzer.service';
import { EmbeddingService } from './rag/embedding.service';
import { VectorStoreService } from './rag/vector-store.service';
import { GitHubModule } from '../github/github.module';

/** Serverless variant: no Bull queue, no WebSocket gateway, no Redis needed. */
@Module({
  imports: [GitHubModule],
  controllers: [AiReviewController],
  providers: [
    AiReviewService,
    AiReviewProcessor,
    DiffParserService,
    PromptBuilderService,
    CodeAnalyzerService,
    EmbeddingService,
    VectorStoreService,
  ],
  exports: [AiReviewService],
})
export class AiReviewServerlessModule {}
