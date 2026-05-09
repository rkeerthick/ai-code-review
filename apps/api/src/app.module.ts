import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { BullModule } from '@nestjs/bull';

import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { RepositoriesModule } from './modules/repositories/repositories.module';
import { PullRequestsModule } from './modules/pull-requests/pull-requests.module';
import { AiReviewModule } from './modules/ai-review/ai-review.module';
import { GitHubModule } from './modules/github/github.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { BillingModule } from './modules/billing/billing.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { QueuesModule } from './queues/queues.module';

@Module({
  controllers: [HealthController],
  imports: [
    // Configuration — load .env, validate required vars
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      validationOptions: { abortEarly: false },
    }),

    // Structured logging with Pino
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get('NODE_ENV') === 'production' ? 'info' : 'debug',
          transport: config.get('NODE_ENV') !== 'production'
            ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
            : undefined,
          redact: ['req.headers.authorization', 'req.body.password'],
          serializers: {
            req: (req) => ({ method: req.method, url: req.url, id: req.id }),
            res: (res) => ({ statusCode: res.statusCode }),
          },
        },
      }),
    }),

    // Rate limiting — global, plan-aware limits applied in guards
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ([{
        ttl: parseInt(config.get('RATE_LIMIT_WINDOW_MS', '60000')),
        limit: parseInt(config.get('RATE_LIMIT_MAX_FREE', '60')),
      }]),
    }),

    // Event bus for domain events
    EventEmitterModule.forRoot({ wildcard: true, delimiter: '.' }),

    // Cron jobs
    ScheduleModule.forRoot(),

    // BullMQ Redis connection (shared config for all queues)
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: new URL(config.get('REDIS_URL', 'redis://localhost:6379')).hostname,
          port: parseInt(new URL(config.get('REDIS_URL', 'redis://localhost:6379')).port || '6379'),
          password: config.get('REDIS_PASSWORD') || undefined,
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 500 },
        },
      }),
    }),

    // Core modules
    DatabaseModule,
    QueuesModule,

    // Feature modules
    AuthModule,
    UsersModule,
    OrganizationsModule,
    RepositoriesModule,
    PullRequestsModule,
    AiReviewModule,
    GitHubModule,
    WebhooksModule,
    BillingModule,
    NotificationsModule,
    AnalyticsModule,
  ],
})
export class AppModule {}
