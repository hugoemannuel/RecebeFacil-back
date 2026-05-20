import { Controller, Get, Post, UseGuards, Request, Body } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
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

  /**
   * POST /subscription/retry-payment
   * Stub para futura integração com Asaas — retentar cobrança do cartão.
   */
  @Post('retry-payment')
  async retryPayment(@Request() req) {
    return this.subscriptionService.getSubscriptionStatus(req.user.id);
  }

  /**
   * POST /subscription/sync
   * Consulta o Asaas e ativa a assinatura se o pagamento já foi confirmado.
   * Fallback para quando o webhook não chegou (dev sem ngrok ou falha de rede).
   */
  @Post('sync')
  async sync(@Request() req) {
    return this.subscriptionService.syncWithAsaas(req.user.id);
  }
}
