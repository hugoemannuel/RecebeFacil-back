import { Controller, Get, Post, UseGuards, Request, Body } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { SubscriptionService } from './subscription.service';
import { CheckoutDto } from './dto/checkout.dto';

@Controller('subscription')
@UseGuards(AuthGuard('jwt'))
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Get('status')
  async getStatus(@Request() req) {
    return this.subscriptionService.getSubscriptionStatus(req.user.id);
  }

  @Post('cancel')
  async cancel(@Request() req) {
    return this.subscriptionService.cancelSubscription(req.user.id);
  }

  @Post('checkout')
  async checkout(@Request() req, @Body() dto: CheckoutDto) {
    return this.subscriptionService.createCheckout(req.user.id, dto.planType, dto.period, dto.document);
  }

  @Post('retry-payment')
  @Throttle({ default: { ttl: 300000, limit: 2 } })
  async retryPayment(@Request() req) {
    return this.subscriptionService.retryPayment(req.user.id);
  }

  @Post('reactivate')
  async reactivate(@Request() req) {
    return this.subscriptionService.reactivateSubscription(req.user.id);
  }

  @Post('change-plan')
  async changePlan(@Request() req, @Body() dto: CheckoutDto) {
    return this.subscriptionService.changePlan(req.user.id, dto.planType, dto.period, dto.document);
  }

  @Get('invoices')
  async getInvoices(@Request() req) {
    return this.subscriptionService.getInvoices(req.user.id);
  }

  @Post('sync')
  async sync(@Request() req) {
    return this.subscriptionService.syncWithAsaas(req.user.id);
  }
}
