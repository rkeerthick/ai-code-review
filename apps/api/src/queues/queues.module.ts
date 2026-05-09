import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { QUEUE_NAMES } from './queue.constants';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_NAMES.AI_REVIEW },
      { name: QUEUE_NAMES.NOTIFICATIONS },
      { name: QUEUE_NAMES.EMBEDDINGS },
      { name: QUEUE_NAMES.GITHUB_SYNC },
    ),
  ],
  exports: [BullModule],
})
export class QueuesModule {}
