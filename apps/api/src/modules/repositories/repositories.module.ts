import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { RepositoriesController } from './repositories.controller';
import { RepositoriesService } from './repositories.service';
import { GitHubModule } from '../github/github.module';
import { QUEUE_NAMES } from '../../queues/queue.constants';

@Module({
  imports: [GitHubModule, BullModule.registerQueue({ name: QUEUE_NAMES.EMBEDDINGS })],
  controllers: [RepositoriesController],
  providers: [RepositoriesService],
  exports: [RepositoriesService],
})
export class RepositoriesModule {}
