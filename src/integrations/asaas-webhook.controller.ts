import { Controller, Get, Post, HttpCode, Body, Headers, UnauthorizedException, Logger, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SubscriptionService } from '../subscription/subscription.service';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../auth/decorators/public.decorator';

@Controller('integrations/asaas')
export class AsaasWebhookController {
  private readonly logger = new Logger(AsaasWebhookController.name);

  constructor(
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => SubscriptionService))
    private readonly subscriptionService: SubscriptionService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('webhook')
  @Public()
  pingWebhook() {
    return { status: 'ok' };
  }

  @Post('webhook')
  @Public()
  @HttpCode(200)
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

      case 'PAYMENT_DELETED':
      case 'PAYMENT_REFUNDED':
        await this.handlePaymentReverted(body.payment, event);
        break;

      case 'SUBSCRIPTION_DELETED':
      case 'SUBSCRIPTION_CANCELED':
        await this.handleSubscriptionCanceled(body.subscription, event);
        break;

      case 'TRANSFER_DONE':
        await this.handleTransferDone(body.transfer);
        break;

      case 'TRANSFER_FAILED':
        await this.handleTransferFailed(body.transfer);
        break;

      default:
        this.logger.debug(`Evento ignorado: ${event}`);
    }

    return { received: true };
  }

  private async handlePaymentConfirmed(payment: any) {
    // Subscription payment
    if (payment?.subscription) {
      this.logger.log(`Pagamento confirmado. Assinatura: ${payment.subscription}, Payment: ${payment.id}`);
      await this.subscriptionService.activateSubscriptionByAsaasId(payment.subscription, payment.id);
      return;
    }

    // Standalone intermediated charge payment
    if (payment?.externalReference) {
      this.logger.log(`Pagamento intermediado confirmado. chargeId: ${payment.externalReference}`);
      await this.prisma.charge.updateMany({
        where: {
          id: payment.externalReference,
          is_intermediated: true,
          status: { not: 'PAID' },
        },
        data: { status: 'PAID', payment_date: new Date() },
      });
    }
  }

  private async handlePaymentOverdue(payment: any) {
    const asaasId = payment?.subscription;
    if (!asaasId) return;
    this.logger.warn(`Pagamento vencido para assinatura: ${asaasId}`);
    await this.subscriptionService.recordOverdueByAsaasId(asaasId, 'PAYMENT_OVERDUE');
  }

  private async handlePaymentReverted(payment: any, event: string) {
    const asaasId = payment?.subscription;
    if (!asaasId) return;
    this.logger.warn(`Pagamento revertido (${event}) para assinatura: ${asaasId}`);
    await this.subscriptionService.downgradeByAsaasId(asaasId, event);
  }

  private async handleSubscriptionCanceled(subscription: any, event: string) {
    const asaasId = subscription?.id;
    if (!asaasId) return;
    this.logger.warn(`Assinatura cancelada no Asaas (${event}). ID: ${asaasId}`);
    await this.subscriptionService.downgradeByAsaasId(asaasId, event);
  }

  private async handleTransferDone(transfer: any) {
    const transferId = transfer?.id;
    if (!transferId) return;
    this.logger.log(`Transferência confirmada. Asaas Transfer ID: ${transferId}`);

    const updated = await this.prisma.withdrawalRecord.updateMany({
      where: { asaas_transfer_id: transferId, status: { not: 'CONFIRMED' } },
      data: { status: 'CONFIRMED', asaas_status: transfer.status ?? 'DONE', confirmed_at: new Date() },
    });

    if (updated.count > 0) {
      const record = await this.prisma.withdrawalRecord.findFirst({
        where: { asaas_transfer_id: transferId },
      });
      if (record) {
        await this.prisma.auditLog.create({
          data: {
            user_id: record.user_id,
            action: 'WITHDRAWAL_CONFIRMED',
            entity: 'WithdrawalRecord',
            entity_id: record.id,
            details: { asaas_transfer_id: transferId },
          },
        });
      }
    }
  }

  private async handleTransferFailed(transfer: any) {
    const transferId = transfer?.id;
    if (!transferId) return;
    const failureReason = transfer?.failReason ?? transfer?.observations ?? 'Transferência recusada pelo Asaas';
    this.logger.warn(`Transferência falhou. Asaas Transfer ID: ${transferId}. Motivo: ${failureReason}`);

    const updated = await this.prisma.withdrawalRecord.updateMany({
      where: { asaas_transfer_id: transferId, status: { not: 'FAILED' } },
      data: { status: 'FAILED', asaas_status: transfer.status ?? 'FAILED', failure_reason: failureReason, failed_at: new Date() },
    });

    if (updated.count > 0) {
      const record = await this.prisma.withdrawalRecord.findFirst({
        where: { asaas_transfer_id: transferId },
      });
      if (record) {
        await this.prisma.auditLog.create({
          data: {
            user_id: record.user_id,
            action: 'WITHDRAWAL_FAILED',
            entity: 'WithdrawalRecord',
            entity_id: record.id,
            details: { asaas_transfer_id: transferId, reason: failureReason },
          },
        });
      }
    }
  }
}
