import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { MessageTrigger, TriggerType } from '@prisma/client';
import { addDays, differenceInCalendarDays, endOfDay, startOfDay } from 'date-fns';

@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  constructor(
    private prisma: PrismaService,
    private whatsapp: WhatsAppService,
  ) {}

  /**
   * Diariamente às 00:00 UTC — gera cobranças a partir de regras de recorrência.
   */
  @Cron('0 0 * * *')
  async handleRecurringChargeGeneration() {
    this.logger.log('Gerando cobranças recorrentes...');
    const today = startOfDay(new Date());

    const rules = await this.prisma.recurringCharge.findMany({
      where: { active: true, next_generation_date: { lte: today } },
      include: {
        debtors: { include: { debtor: true } },
        _count: { select: { charges: true } },
      },
    });

    for (const rule of rules) {
      try {
        const generated = rule._count.charges;

        if (rule.max_installments !== null && generated >= rule.max_installments) {
          await this.prisma.recurringCharge.update({ where: { id: rule.id }, data: { active: false } });
          this.logger.log(`Regra ${rule.id} encerrada (${generated}/${rule.max_installments} parcelas).`);
          continue;
        }

        for (const { debtor } of rule.debtors) {
          await this.prisma.charge.create({
            data: {
              creditor_id: rule.creditor_id,
              debtor_id: debtor.id,
              amount: rule.amount,
              description: rule.description,
              due_date: rule.next_generation_date,
              custom_message: rule.custom_message,
              status: 'PENDING',
              recurring_charge_id: rule.id,
            },
          });
        }

        const next = this.calcNextDate(rule.next_generation_date, rule.frequency);
        await this.prisma.recurringCharge.update({
          where: { id: rule.id },
          data: { next_generation_date: next },
        });

        this.logger.log(`Regra ${rule.id}: parcela ${generated + 1} gerada.`);
      } catch (err) {
        this.logger.error(`Erro ao gerar cobrança para regra ${rule.id}:`, err);
      }
    }
  }

  private calcNextDate(from: Date, frequency: string): Date {
    const d = new Date(from);
    if (frequency === 'WEEKLY') d.setDate(d.getDate() + 7);
    else if (frequency === 'MONTHLY') d.setMonth(d.getMonth() + 1);
    else if (frequency === 'YEARLY') d.setFullYear(d.getFullYear() + 1);
    return d;
  }

  /**
   * A cada hora cheia (UTC) — marca OVERDUE e envia automações para credores
   * cujo send_hour bate com a hora atual em BRT (America/Sao_Paulo, UTC-3).
   */
  @Cron('0 * * * *')
  async handleDailyBillingSync(): Promise<void> {
    this.logger.log('Sincronização horária iniciada...');
    try {
      await this.markOverdueCharges();
      const currentHour = this.getBRTHour();
      await this.processAutomationQueue(currentHour);
      this.logger.log('Sincronização horária finalizada.');
    } catch (error) {
      this.logger.error('Erro fatal na rotina de automação:', error);
    }
  }

  getBRTHour(): number {
    return new Date(
      new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }),
    ).getHours();
  }

  private async markOverdueCharges(): Promise<void> {
    const today = startOfDay(new Date());
    const result = await this.prisma.charge.updateMany({
      where: {
        status: 'PENDING',
        is_intermediated: false,
        due_date: { lt: today },
      },
      data: { status: 'OVERDUE' },
    });
    if (result.count > 0) {
      this.logger.log(`${result.count} cobranças (PIX Direto) marcadas como OVERDUE.`);
    }
  }

  /**
   * Busca credores com send_hour = currentHour e dispara notificações
   * respeitando automation_days_before/after e os flags por gatilho.
   */
  private async processAutomationQueue(currentHour: number): Promise<void> {
    const today = startOfDay(new Date());

    const configs = await this.prisma.integrationConfig.findMany({
      where: { allows_automation: true, send_hour: currentHour },
    });

    if (configs.length === 0) return;

    const creditorIds = configs.map(c => c.user_id);
    const configMap = new Map(configs.map(c => [c.user_id, c]));

    const maxDaysBefore = Math.max(...configs.map(c => c.automation_days_before));
    const maxDaysAfter = Math.max(...configs.map(c => c.automation_days_after));

    const charges = await this.prisma.charge.findMany({
      where: {
        creditor_id: { in: creditorIds },
        status: { in: ['PENDING', 'OVERDUE'] },
        due_date: {
          gte: addDays(today, -maxDaysAfter),
          lte: endOfDay(addDays(today, maxDaysBefore)),
        },
      },
      include: {
        debtor: true,
        creditor: {
          include: {
            creditor_profile: { include: { message_templates: true } },
            integration_config: true,
          },
        },
        messages: { where: { sent_at: { gte: today } } },
      },
    });

    this.logger.log(
      `Processando ${charges.length} cobrança(s) para ${configs.length} credor(es) [send_hour=${currentHour}h BRT].`,
    );

    for (const charge of charges) {
      const config = configMap.get(charge.creditor_id);
      if (!config) continue;

      const dueDate = startOfDay(new Date(charge.due_date));
      const diffDays = differenceInCalendarDays(dueDate, today);

      let trigger: MessageTrigger | null = null;
      let triggerType: TriggerType | null = null;

      if (diffDays === config.automation_days_before && config.allow_before_due && charge.status === 'PENDING') {
        trigger = 'BEFORE_DUE';
        triggerType = TriggerType.AUTO_REMINDER_BEFORE;
      } else if (diffDays === 0 && config.allow_on_due && charge.status === 'PENDING') {
        trigger = 'ON_DUE';
        triggerType = TriggerType.AUTO_REMINDER_DUE;
      } else if (diffDays === -config.automation_days_after && config.allow_overdue && charge.status === 'OVERDUE') {
        trigger = 'OVERDUE';
        triggerType = TriggerType.AUTO_REMINDER_OVERDUE;
      }

      if (!trigger || !triggerType) continue;

      const alreadySent = charge.messages.some((m: any) => m.trigger_type === triggerType);
      if (alreadySent) continue;

      await this.sendNotification(charge, trigger, triggerType);
    }
  }

  private async sendNotification(charge: any, trigger: MessageTrigger, triggerType: TriggerType): Promise<void> {
    const template = charge.creditor.creditor_profile?.message_templates?.find(
      (t: any) =>
        t.trigger === trigger &&
        (t.is_default || charge.creditor.creditor_profile?.message_templates.length === 1),
    );

    const message = this.buildAutomaticMessage(charge, trigger, template?.body);

    try {
      await this.whatsapp.sendText(charge.debtor.phone, message);
      await this.prisma.messageHistory.create({
        data: {
          charge_id: charge.id,
          trigger_type: triggerType,
          status: 'SENT',
          zapi_message_id: 'AUTO_' + Math.random().toString(36).substring(7),
        },
      });
      this.logger.log(`Notificação ${trigger} enviada: ${charge.debtor.name}`);
    } catch (err) {
      this.logger.error(`Erro no disparo para cobrança ${charge.id}:`, err);
      try {
        await this.prisma.messageHistory.create({
          data: {
            charge_id: charge.id,
            trigger_type: triggerType,
            status: 'FAILED',
            error_details: err instanceof Error ? err.message : String(err),
          },
        });
      } catch {}
    }
  }

  private buildAutomaticMessage(charge: any, trigger: string, templateBody?: string): string {
    const amountStr = (charge.amount / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const profile = charge.creditor.creditor_profile;
    const businessName = profile?.business_name || charge.creditor.name;
    const dueDateStr = new Date(charge.due_date).toLocaleDateString('pt-BR');
    const pixKey = profile?.pix_key || '[Chave PIX não configurada]';

    if (templateBody) {
      return templateBody
        .replace(/{{nome}}/g, charge.debtor.name)
        .replace(/{{valor}}/g, amountStr)
        .replace(/{{vencimento}}/g, dueDateStr)
        .replace(/{{empresa}}/g, businessName)
        .replace(/{{chave_pix}}/g, pixKey)
        .replace(/{{link_pagamento}}/g, `recebefacil.com.br/pay/${charge.id}`);
    }

    const pixSuffix = `\n\n💰 *Pague via PIX (Chave):*\n${pixKey}`;

    if (trigger === 'BEFORE_DUE') {
      return `Olá *${charge.debtor.name}*! 👋\n\nLembrete amigável: sua fatura de *${amountStr}* com a *${businessName}* vence em breve (${dueDateStr}).${pixSuffix}\n\nLink: recebefacil.com.br/pay/${charge.id}`;
    }

    if (trigger === 'ON_DUE') {
      return `Oi *${charge.debtor.name}*! 🚀\n\nSua fatura de *${amountStr}* da *${businessName}* vence hoje.${pixSuffix}\n\nAcesse o link para o QR Code: recebefacil.com.br/pay/${charge.id}`;
    }

    if (trigger === 'OVERDUE') {
      return `Olá *${charge.debtor.name}*. ⚠️\n\nSua fatura de *${amountStr}* com a *${businessName}* está vencida.${pixSuffix}\n\nRegularize agora: recebefacil.com.br/pay/${charge.id}`;
    }

    return `Olá ${charge.debtor.name}, cobrança de ${amountStr} disponível. Chave PIX: ${pixKey}`;
  }
}
