import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService) {
    super({
      datasources: { db: { url: config.get('DATABASE_URL') } },
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
    });

    // Log slow queries in development
    if (config.get('NODE_ENV') !== 'production') {
      (this as any).$on('query', (e: { duration: number; query: string }) => {
        if (e.duration > 500) {
          this.logger.warn(`Slow query (${e.duration}ms): ${e.query.slice(0, 100)}`);
        }
      });
    }
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  // Soft delete helper — adds deletedAt filter to all queries
  withSoftDelete() {
    return this.$extends({
      query: {
        $allModels: {
          async findMany({ model, operation, args, query }: any) {
            if (args.where !== undefined) {
              if (args.where.deletedAt === undefined) {
                args.where.deletedAt = null;
              }
            } else {
              args.where = { deletedAt: null };
            }
            return query(args);
          },
          async findFirst({ args, query }: any) {
            args.where = { ...args.where, deletedAt: null };
            return query(args);
          },
          async findUnique({ args, query }: any) {
            return query(args);
          },
        },
      },
    });
  }
}
