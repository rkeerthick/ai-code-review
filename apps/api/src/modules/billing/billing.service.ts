import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PrismaService } from '../../database/prisma.service';
import { Plan } from '@prisma/client';

const PLAN_LIMITS: Record<Plan, { repos: number; members: number; reviews: number }> = {
  FREE:       { repos: 3,    members: 3,    reviews: 50 },
  PRO:        { repos: 25,   members: 5,    reviews: 500 },
  TEAM:       { repos: 100,  members: 25,   reviews: 2500 },
  ENTERPRISE: { repos: -1,   members: -1,   reviews: -1 }, // unlimited
};

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly stripe: Stripe;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    this.stripe = new Stripe(config.getOrThrow('STRIPE_SECRET_KEY'), {
      apiVersion: '2025-02-24.acacia',
    });
  }

  async createCheckoutSession(
    organizationId: string,
    plan: 'PRO' | 'TEAM',
    userId: string,
  ) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      include: { subscription: true },
    });

    if (org.subscription?.status === 'ACTIVE' && org.plan !== 'FREE') {
      throw new BadRequestException('Org already has an active subscription. Use billing portal to change plans.');
    }

    const priceId = plan === 'PRO'
      ? this.config.getOrThrow('STRIPE_PRICE_PRO_MONTHLY')
      : this.config.getOrThrow('STRIPE_PRICE_TEAM_MONTHLY');

    // Create or retrieve Stripe customer
    let customerId = org.stripeCustomerId;
    if (!customerId) {
      const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
      const customer = await this.stripe.customers.create({
        email: user.email,
        name: org.name,
        metadata: { organizationId, userId },
      });
      customerId = customer.id;
      await this.prisma.organization.update({
        where: { id: organizationId },
        data: { stripeCustomerId: customerId },
      });
    }

    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${this.config.get('APP_URL')}/dashboard/billing?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.config.get('APP_URL')}/dashboard/billing?canceled=true`,
      subscription_data: {
        metadata: { organizationId },
        trial_period_days: 14,
      },
      metadata: { organizationId, plan },
    });

    return { url: session.url };
  }

  async createPortalSession(organizationId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });

    if (!org.stripeCustomerId) {
      throw new NotFoundException('No billing account found');
    }

    const session = await this.stripe.billingPortal.sessions.create({
      customer: org.stripeCustomerId,
      return_url: `${this.config.get('APP_URL')}/dashboard/billing`,
    });

    return { url: session.url };
  }

  async handleStripeWebhook(payload: Buffer, signature: string) {
    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        this.config.getOrThrow('STRIPE_WEBHOOK_SECRET'),
      );
    } catch {
      throw new BadRequestException('Invalid Stripe webhook signature');
    }

    this.logger.log(`Stripe event: ${event.type}`);

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdate(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case 'invoice.payment_succeeded':
        await this.handlePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;
      case 'invoice.payment_failed':
        await this.handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;
    }

    return { received: true };
  }

  private async handleSubscriptionUpdate(subscription: Stripe.Subscription) {
    const orgId = subscription.metadata.organizationId;
    if (!orgId) return;

    const plan = this.derivePlan(subscription);
    const limits = PLAN_LIMITS[plan];

    await this.prisma.$transaction([
      this.prisma.organization.update({
        where: { id: orgId },
        data: {
          plan,
          maxRepositories: limits.repos,
          maxMembers: limits.members,
          maxReviewsPerMonth: limits.reviews,
        },
      }),
      this.prisma.subscription.upsert({
        where: { organizationId: orgId },
        create: {
          organizationId: orgId,
          plan,
          status: this.mapStripeStatus(subscription.status),
          stripeSubscriptionId: subscription.id,
          stripePriceId: subscription.items.data[0]?.price.id,
          stripeCurrentPeriodStart: new Date(subscription.current_period_start * 1000),
          stripeCurrentPeriodEnd: new Date(subscription.current_period_end * 1000),
          trialEndsAt: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
        },
        update: {
          plan,
          status: this.mapStripeStatus(subscription.status),
          stripePriceId: subscription.items.data[0]?.price.id,
          stripeCurrentPeriodStart: new Date(subscription.current_period_start * 1000),
          stripeCurrentPeriodEnd: new Date(subscription.current_period_end * 1000),
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
        },
      }),
    ]);

    this.logger.log(`Subscription updated: org=${orgId} plan=${plan}`);
  }

  private async handleSubscriptionDeleted(subscription: Stripe.Subscription) {
    const orgId = subscription.metadata.organizationId;
    if (!orgId) return;

    const limits = PLAN_LIMITS.FREE;
    await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        plan: 'FREE',
        maxRepositories: limits.repos,
        maxMembers: limits.members,
        maxReviewsPerMonth: limits.reviews,
      },
    });
    await this.prisma.subscription.updateMany({
      where: { organizationId: orgId },
      data: { status: 'CANCELED', plan: 'FREE' },
    });

    this.logger.log(`Subscription canceled: org=${orgId} — downgraded to FREE`);
  }

  private async handlePaymentSucceeded(invoice: Stripe.Invoice) {
    this.logger.log(`Payment succeeded: invoice=${invoice.id}`);
  }

  private async handlePaymentFailed(invoice: Stripe.Invoice) {
    this.logger.warn(`Payment failed: invoice=${invoice.id}`);
  }

  private derivePlan(subscription: Stripe.Subscription): Plan {
    const metadata = subscription.metadata;
    if (metadata?.plan === 'TEAM') return 'TEAM';
    if (metadata?.plan === 'PRO') return 'PRO';
    if (metadata?.plan === 'ENTERPRISE') return 'ENTERPRISE';
    return 'PRO';
  }

  private mapStripeStatus(status: string): any {
    const map: Record<string, string> = {
      active: 'ACTIVE',
      canceled: 'CANCELED',
      past_due: 'PAST_DUE',
      trialing: 'TRIALING',
      unpaid: 'UNPAID',
    };
    return map[status] ?? 'ACTIVE';
  }

  async getSubscription(organizationId: string) {
    return this.prisma.subscription.findUnique({
      where: { organizationId },
    });
  }

  async checkReviewLimit(organizationId: string): Promise<boolean> {
    const now = new Date();
    const month = parseInt(`${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`);

    const [org, usage] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { maxReviewsPerMonth: true },
      }),
      this.prisma.usageMetric.findUnique({
        where: { organizationId_month: { organizationId, month } },
        select: { reviewsCount: true },
      }),
    ]);

    if (org.maxReviewsPerMonth === -1) return true; // unlimited
    const current = usage?.reviewsCount ?? 0;
    return current < org.maxReviewsPerMonth;
  }

  async incrementUsage(organizationId: string, tokens: number, costUsd: number) {
    const now = new Date();
    const month = parseInt(`${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`);

    await this.prisma.usageMetric.upsert({
      where: { organizationId_month: { organizationId, month } },
      create: { organizationId, month, reviewsCount: 1, tokensUsed: tokens, costUsd },
      update: {
        reviewsCount: { increment: 1 },
        tokensUsed: { increment: tokens },
        costUsd: { increment: costUsd },
      },
    });
  }
}
