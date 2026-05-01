import { Controller, Get, Post, UseGuards, Request, Body } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SubscriptionService } from './subscription.service';

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
  async checkout(@Request() req, @Body() dto: any) {
    return this.subscriptionService.createCheckout(req.user.id, dto.planType, dto.period, dto.document);
  }

  /**
   * POST /subscription/retry-payment
   * Stub para futura integração com Asaas — retentar cobrança do cartão.
   * Implementar quando Asaas Connect estiver ativo.
   */
  @Post('retry-payment')
  async retryPayment(@Request() req) {
    return this.subscriptionService.getSubscriptionStatus(req.user.id);
  }
}
