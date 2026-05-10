import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';

import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { RepositoriesModule } from './modules/repositories/repositories.module';
import { PullRequestsModule } from './modules/pull-requests/pull-requests.module';
import { AiReviewServerlessModule } from './modules/ai-review/ai-review-serverless.module';
import { GitHubModule } from './modules/github/github.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { BillingModule } from './modules/billing/billing.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { HealthController } from './health.controller';

/** No Bull, no Redis, no WebSocket — safe to run in Vercel serverless. */
@Module({
  controllers: [HealthController],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      validationOptions: { abortEarly: false },
    }),

    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: 'info',
          transport: config.get('NODE_ENV') !== 'production'
            ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
            : undefined,
          redact: ['req.headers.authorization', 'req.body.password'],
        },
      }),
    }),

    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ([{
        ttl: parseInt(config.get('RATE_LIMIT_WINDOW_MS', '60000')),
        limit: parseInt(config.get('RATE_LIMIT_MAX_FREE', '60')),
      }]),
    }),

    EventEmitterModule.forRoot({ wildcard: true, delimiter: '.' }),
    ScheduleModule.forRoot(),

    DatabaseModule,
    AuthModule,
    UsersModule,
    OrganizationsModule,
    RepositoriesModule,
    PullRequestsModule,
    AiReviewServerlessModule,
    GitHubModule,
    WebhooksModule,
    BillingModule,
    NotificationsModule,
    AnalyticsModule,
  ],
})
export class AppServerlessModule {}
