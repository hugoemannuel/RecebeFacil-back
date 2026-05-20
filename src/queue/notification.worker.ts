import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { TriggerType } from '@prisma/client';
import { startOfDay } from 'date-fns';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService, ZApiCredentials } from '../whatsapp/whatsapp.service';
import { PgBossService, NOTIFICATION_QUEUE } from './pg-boss.service';

export interface NotificationJobData {
  chargeId: string;
  trigger: 'BEFORE_DUE' | 'ON_DUE' | 'OVERDUE';
}

@Injectable()
export class NotificationWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger(NotificationWorker.name);

  constructor(
    private readonly pgBoss: PgBossService,
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  async onApplicationBootstrap() {
    await this.pgBoss.instance.createQueue(NOTIFICATION_QUEUE);
    await this.pgBoss.instance.work<NotificationJobData>(
      NOTIFICATION_QUEUE,
      async (jobs) => {
        for (const job of jobs) {
          await this.handle(job.data);
        }
      },
    );
    this.logger.log(`Worker registrado na fila "${NOTIFICATION_QUEUE}"`);
  }

  async handle(data: NotificationJobData): Promise<void> {
    const { chargeId, trigger } = data;

    const charge = await this.prisma.charge.findUnique({
      where: { id: chargeId },
      include: {
        debtor: true,
        creditor: {
          include: {
            creditor_profile: { include: { message_templates: true } },
            integration_config: true,
          },
        },
      },
    });

    if (!charge) return; // idempotência: cobrança pode ter sido deletada

    const today = startOfDay(new Date());
    const alreadySent = await this.prisma.messageHistory.findFirst({
      where: {
        charge_id: chargeId,
        trigger_type: TriggerType.MANUAL,
        sent_at: { gte: today },
      },
    });
    if (alreadySent) {
      this.logger.warn(`Anti-spam: MANUAL já enviado hoje para cobrança ${chargeId}`);
      return;
    }

    const message = this.buildMessage(charge, trigger);

    const integrationConfig = charge.creditor.integration_config;
    const credentials: ZApiCredentials | undefined =
      integrationConfig?.zapi_instance_id && integrationConfig?.zapi_instance_token
        ? {
            instanceId:  integrationConfig.zapi_instance_id,
            token:       integrationConfig.zapi_instance_token,
            clientToken: process.env.ZAPI_CLIENT_TOKEN ?? '',
          }
        : undefined;

    try {
      await this.whatsapp.sendText(charge.debtor.phone, message, credentials);
      await this.prisma.messageHistory.create({
        data: { charge_id: chargeId, trigger_type: TriggerType.MANUAL, status: 'SENT' },
      });
      this.logger.log(`Notificação manual enviada: ${charge.debtor.name} (${trigger})`);
    } catch (err) {
      this.logger.error(`Falha no envio manual para cobrança ${chargeId}:`, err);
      await this.prisma.messageHistory.create({
        data: {
          charge_id: chargeId,
          trigger_type: TriggerType.MANUAL,
          status: 'FAILED',
          error_details: err instanceof Error ? err.message : String(err),
        },
      });
      throw err; // pg-boss marca o job como failed para eventual retry
    }
  }

  private buildMessage(charge: any, trigger: string): string {
    const amountStr = (charge.amount / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const profile = charge.creditor.creditor_profile;
    const businessName = profile?.business_name || charge.creditor.name;
    const dueDateStr = new Date(charge.due_date).toLocaleDateString('pt-BR');
    const pixKey = profile?.pix_key || '[Chave PIX não configurada]';

    const template = (profile?.message_templates ?? []).find(
      (t: any) => t.trigger === trigger && t.is_default,
    ) ?? (profile?.message_templates ?? []).find((t: any) => t.trigger === trigger);

    if (template?.body) {
      return template.body
        .replace(/{{nome}}/g, charge.debtor.name)
        .replace(/{{valor}}/g, amountStr)
        .replace(/{{vencimento}}/g, dueDateStr)
        .replace(/{{empresa}}/g, businessName)
        .replace(/{{chave_pix}}/g, pixKey)
        .replace(/{{link_pagamento}}/g, `recebefacil.com.br/pay/${charge.id}`);
    }

    const pixSuffix = `\n\n💰 *Pague via PIX:*\n${pixKey}`;
    if (trigger === 'BEFORE_DUE')
      return `Olá *${charge.debtor.name}*! 👋\n\nLembrete: sua fatura de *${amountStr}* com *${businessName}* vence em ${dueDateStr}.${pixSuffix}\n\nLink: recebefacil.com.br/pay/${charge.id}`;
    if (trigger === 'ON_DUE')
      return `Oi *${charge.debtor.name}*! 🚀\n\nSua fatura de *${amountStr}* com *${businessName}* vence hoje.${pixSuffix}\n\nAcesse: recebefacil.com.br/pay/${charge.id}`;
    if (trigger === 'OVERDUE')
      return `Olá *${charge.debtor.name}*. ⚠️\n\nSua fatura de *${amountStr}* com *${businessName}* está vencida.${pixSuffix}\n\nRegularize: recebefacil.com.br/pay/${charge.id}`;

    return `Olá ${charge.debtor.name}, cobrança de ${amountStr}. Chave PIX: ${pixKey}`;
  }
}
