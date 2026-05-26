import { Injectable, Logger, OnApplicationBootstrap, Inject, forwardRef } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { PgBossService, WEBHOOK_ASAAS_QUEUE, WEBHOOK_ASAAS_DLQ } from '../queue/pg-boss.service';

interface WebhookJobData {
  webhookEventId: string;
}

@Injectable()
export class AsaasWebhookWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger(AsaasWebhookWorker.name);

  constructor(
    private readonly pgBoss: PgBossService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => SubscriptionService))
    private readonly subscriptionService: SubscriptionService,
  ) {}

  async onApplicationBootstrap() {
    await this.pgBoss.ready();
    await this.pgBoss.instance.createQueue(WEBHOOK_ASAAS_DLQ);
    await this.pgBoss.instance.createQueue(WEBHOOK_ASAAS_QUEUE, {
      retryLimit: 5,
      retryDelay: 30,
      retryBackoff: true,
      deadLetter: WEBHOOK_ASAAS_DLQ,
    });
    await this.pgBoss.instance.work<WebhookJobData>(
      WEBHOOK_ASAAS_QUEUE,
      async (jobs) => {
        for (const job of jobs) {
          await this.processEvent(job.data.webhookEventId);
        }
      },
    );
    this.logger.log(`Worker registrado na fila "${WEBHOOK_ASAAS_QUEUE}"`);
  }

  async processEvent(webhookEventId: string): Promise<void> {
    const event = await this.prisma.webhookEvent.findUnique({
      where: { id: webhookEventId },
    });

    if (!event) {
      this.logger.warn(`WebhookEvent ${webhookEventId} não encontrado — ignorando`);
      return;
    }

    if (event.processed) {
      this.logger.log(`WebhookEvent ${webhookEventId} já processado — ignorando`);
      return;
    }

    try {
      await this.dispatch(event.event_type, event.payload as any);
      await this.prisma.webhookEvent.update({
        where: { id: webhookEventId },
        data: { processed: true, processed_at: new Date() },
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.prisma.webhookEvent.update({
        where: { id: webhookEventId },
        data: {
          retry_count: { increment: 1 },
          error: errorMessage,
        },
      });
      throw err; // pg-boss retry
    }
  }

  private async dispatch(eventType: string, payload: any): Promise<void> {
    switch (eventType) {
      case 'PAYMENT_CONFIRMED':
      case 'PAYMENT_RECEIVED':
        await this.handlePaymentConfirmed(payload.payment);
        break;

      case 'PAYMENT_OVERDUE':
        await this.handlePaymentOverdue(payload.payment);
        break;

      case 'PAYMENT_DELETED':
      case 'PAYMENT_REFUNDED':
        await this.handlePaymentReverted(payload.payment, eventType);
        break;

      case 'SUBSCRIPTION_DELETED':
      case 'SUBSCRIPTION_CANCELED':
        await this.handleSubscriptionCanceled(payload.subscription, eventType);
        break;

      case 'TRANSFER_DONE':
        await this.handleTransferDone(payload.transfer);
        break;

      case 'TRANSFER_FAILED':
        await this.handleTransferFailed(payload.transfer);
        break;

      default:
        this.logger.debug(`Evento Asaas não mapeado: ${eventType}`);
    }
  }

  private async handlePaymentConfirmed(payment: any): Promise<void> {
    if (payment?.subscription) {
      this.logger.log(`Pagamento confirmado. Assinatura: ${payment.subscription}, Payment: ${payment.id}`);
      await this.subscriptionService.activateSubscriptionByAsaasId(payment.subscription, payment.id);
      return;
    }

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

  private async handlePaymentOverdue(payment: any): Promise<void> {
    const asaasId = payment?.subscription;
    if (!asaasId) return;
    this.logger.warn(`Pagamento vencido para assinatura: ${asaasId}`);
    await this.subscriptionService.recordOverdueByAsaasId(asaasId, 'PAYMENT_OVERDUE');
  }

  private async handlePaymentReverted(payment: any, event: string): Promise<void> {
    const asaasId = payment?.subscription;
    if (!asaasId) return;
    this.logger.warn(`Pagamento revertido (${event}) para assinatura: ${asaasId}`);
    await this.subscriptionService.downgradeByAsaasId(asaasId, event);
  }

  private async handleSubscriptionCanceled(subscription: any, event: string): Promise<void> {
    const asaasId = subscription?.id;
    if (!asaasId) return;
    this.logger.warn(`Assinatura cancelada no Asaas (${event}). ID: ${asaasId}`);
    await this.subscriptionService.downgradeByAsaasId(asaasId, event);
  }

  private async handleTransferDone(transfer: any): Promise<void> {
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
    } else {
      this.logger.warn(`TRANSFER_DONE sem WithdrawalRecord correspondente: ${transferId}`);
    }
  }

  @Cron('0 7 * * *')
  async checkDlqHealth(): Promise<void> {
    try {
      const stats = await this.pgBoss.instance.getQueueStats(WEBHOOK_ASAAS_DLQ);
      const count = stats?.queuedCount ?? 0;
      if (count > 5) {
        this.logger.error(`⚠️ DLQ de webhooks Asaas tem ${count} jobs pendentes — investigar imediatamente`);
        await this.prisma.auditLog.create({
          data: {
            action: 'WEBHOOK_DLQ_ALERT',
            entity: 'WebhookEvent',
            entity_id: 'DLQ',
            details: { dlq: WEBHOOK_ASAAS_DLQ, count },
          },
        });
      } else if (count > 0) {
        this.logger.warn(`DLQ de webhooks Asaas tem ${count} job(s)`);
      }
    } catch (err) {
      this.logger.error('Erro ao verificar DLQ:', err);
    }
  }

  private async handleTransferFailed(transfer: any): Promise<void> {
    const transferId = transfer?.id;
    if (!transferId) return;
    const failureReason = transfer?.failReason ?? transfer?.observations ?? 'Transferência recusada pelo Asaas';
    this.logger.warn(`Transferência falhou. Asaas Transfer ID: ${transferId}. Motivo: ${failureReason}`);

    const updated = await this.prisma.withdrawalRecord.updateMany({
      where: { asaas_transfer_id: transferId, status: { not: 'FAILED' } },
      data: {
        status: 'FAILED',
        asaas_status: transfer.status ?? 'FAILED',
        failure_reason: failureReason,
        failed_at: new Date(),
      },
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
