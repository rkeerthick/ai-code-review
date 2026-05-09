import {
  Controller, Post, Get, Body, Req, Param,
  UseGuards, HttpCode, HttpStatus, RawBodyRequest,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrgId } from '../../common/decorators/org-id.decorator';
import { BillingService } from './billing.service';

class CreateCheckoutDto {
  @ApiProperty({ enum: ['PRO', 'TEAM'] })
  @IsEnum(['PRO', 'TEAM'])
  plan: 'PRO' | 'TEAM';
}

@ApiTags('billing')
@Controller({ path: 'billing', version: '1' })
export class BillingController {
  constructor(private billing: BillingService) {}

  @Post('checkout')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Create Stripe checkout session for plan upgrade' })
  createCheckout(
    @OrgId() orgId: string,
    @CurrentUser() user: any,
    @Body() dto: CreateCheckoutDto,
  ) {
    return this.billing.createCheckoutSession(orgId, dto.plan, user.id);
  }

  @Post('portal')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Create Stripe billing portal session' })
  createPortal(@OrgId() orgId: string) {
    return this.billing.createPortalSession(orgId);
  }

  @Get('subscription')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get current subscription details' })
  getSubscription(@OrgId() orgId: string) {
    return this.billing.getSubscription(orgId);
  }

  @Public()
  @Post('webhooks/stripe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stripe webhook endpoint' })
  handleStripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Req() request: Request,
  ) {
    const signature = request.headers['stripe-signature'] as string;
    return this.billing.handleStripeWebhook(req.rawBody!, signature);
  }
}
