import {
  Controller,
  Post,
  Headers,
  Req,
  HttpCode,
  HttpStatus,
  RawBodyRequest,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { WebhooksService } from './webhooks.service';

@ApiTags('webhooks')
@Controller({ path: 'webhooks', version: '1' })
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private webhooks: WebhooksService) {}

  @Public()
  @Post('github')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'GitHub webhook receiver' })
  async receiveGitHub(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string,
    @Headers('x-github-event') eventType: string,
    @Headers('x-github-delivery') deliveryId: string,
  ) {
    this.logger.debug(`Webhook: ${eventType} delivery=${deliveryId}`);

    const rawBody = req.rawBody;
    if (!rawBody) {
      // rawBody requires NestJS to be configured with raw body parsing
      return { accepted: true };
    }

    const result = await this.webhooks.handleGitHubWebhook(
      rawBody,
      signature,
      eventType,
    );

    return { accepted: true, ...result };
  }
}
