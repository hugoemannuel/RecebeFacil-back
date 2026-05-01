import { Controller, Get, Post, Body, Headers, UnauthorizedException, Logger, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SubscriptionService } from '../subscription/subscription.service';
import { Public } from '../auth/decorators/public.decorator';

@Controller('integrations/asaas')
export class AsaasWebhookController {
  private readonly logger = new Logger(AsaasWebhookController.name);

  constructor(
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => SubscriptionService))
    private readonly subscriptionService: SubscriptionService,
  ) {}

  @Get('webhook')
  @Public()
  pingWebhook() {
    return { status: 'ok' };
  }

  @Post('webhook')
  @Public()
  async handleWebhook(
    @Body() body: any,
    @Headers('asaas-access-token') token: string,
  ) {
    const secret = this.configService.get<string>('ASAAS_WEBHOOK_SECRET');

    if (!token || token !== secret) {
      this.logger.warn('Webhook Asaas rejeitado: token inválido');
      throw new UnauthorizedException('Invalid webhook token');
    }

    const event: string = body?.event;
    this.logger.log(`Webhook Asaas recebido. Evento: ${event}`);

    switch (event) {
      case 'PAYMENT_CONFIRMED':
      case 'PAYMENT_RECEIVED':
        await this.handlePaymentConfirmed(body.payment);
        break;

      case 'PAYMENT_OVERDUE':
        await this.handlePaymentOverdue(body.payment);
        break;

      default:
        this.logger.debug(`Evento ignorado: ${event}`);
    }

    return { received: true };
  }

  private async handlePaymentConfirmed(payment: any) {
    if (!payment?.subscription) return;
    this.logger.log(`Pagamento confirmado para assinatura: ${payment.subscription}`);
    await this.subscriptionService.activateSubscriptionByAsaasId(payment.subscription);
  }

  private async handlePaymentOverdue(payment: any) {
    const asaasId = payment?.subscription;
    if (!asaasId) return;
    this.logger.warn(`Pagamento vencido para assinatura: ${asaasId}`);
    await this.subscriptionService.recordOverdueByAsaasId(asaasId, 'PAYMENT_OVERDUE');
  }
}
