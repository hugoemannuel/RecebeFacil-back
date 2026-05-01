import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { MessageTrigger, TriggerType } from '@prisma/client';
import { addDays, startOfDay, endOfDay } from 'date-fns';

@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  constructor(
    private prisma: PrismaService,
    private whatsapp: WhatsAppService,
  ) {}

  /**
   * Rotina diária às 00:30 AM
   * Sincroniza status de faturas e processa automações de mensagens.
   */
  @Cron('30 0 * * *')
  async handleDailyBillingSync() {
    this.logger.log('Iniciando sincronização diária de cobranças (00:30)...');
    
    try {
      const today = startOfDay(new Date());

      /**
       * REGRA DE OURO: Atualização de Status
       * Somente para cobranças NÃO intermediadas (PIX Direto).
       * Cobranças via Asaas dependem de Webhook para manter a integridade com o gateway.
       */
      const overdueResult = await this.prisma.charge.updateMany({
        where: {
          status: 'PENDING',
          is_intermediated: false, // Evita conflito com Asaas
          due_date: {
            lt: today,
          },
        },
        data: {
          status: 'OVERDUE',
        },
      });

      if (overdueResult.count > 0) {
        this.logger.log(`${overdueResult.count} cobranças (PIX Direto) marcadas como OVERDUE.`);
      }

      // 2. Processar fila de automação de mensagens
      await this.processAutomationQueue();

      this.logger.log('Sincronização diária finalizada com sucesso.');
    } catch (error) {
      this.logger.error('Erro fatal na rotina de automação:', error);
    }
  }

  /**
   * Identifica e dispara notificações baseadas em regras de tempo.
   * Verifica permissão de automação do usuário.
   */
  private async processAutomationQueue() {
    const today = startOfDay(new Date());
    const inTwoDays = addDays(today, 2);
    const yesterday = addDays(today, -1);

    this.logger.log('Processando fila de notificações...');

    // A. Lembretes de Vencimento HOJE (ON_DUE)
    await this.notifyChargesForPeriod(today, endOfDay(today), 'ON_DUE', TriggerType.AUTO_REMINDER_DUE);

    // B. Lembretes Antecipados (2 dias antes - BEFORE_DUE)
    await this.notifyChargesForPeriod(inTwoDays, endOfDay(inTwoDays), 'BEFORE_DUE', TriggerType.AUTO_REMINDER_BEFORE);

    // C. Lembretes de Atraso (1 dia após - OVERDUE)
    await this.notifyChargesForPeriod(yesterday, endOfDay(yesterday), 'OVERDUE', TriggerType.AUTO_REMINDER_OVERDUE);
  }

  private async notifyChargesForPeriod(start: Date, end: Date, trigger: MessageTrigger, type: TriggerType) {
    const charges = await this.prisma.charge.findMany({
      where: {
        due_date: {
          gte: start,
          lte: end,
        },
        status: trigger === 'OVERDUE' ? 'OVERDUE' : 'PENDING',
        // REGRA: O credor deve permitir automação explicitamente
        creditor: {
          integration_config: {
            allows_automation: true,
          }
        },
        // REGRA: Evitar spam (não enviar se já houver mensagem para este gatilho hoje)
        messages: {
          none: {
            trigger_type: type,
            sent_at: {
              gte: startOfDay(new Date()),
            }
          }
        }
      },
      include: {
        debtor: true,
        creditor: {
          include: {
            creditor_profile: {
              include: {
                message_templates: true
              }
            },
            integration_config: true
          }
        }
      }
    });

    for (const charge of charges) {
      // Buscar template customizado ou usar o padrão do sistema
      const template = charge.creditor.creditor_profile?.message_templates?.find(
        t => t.trigger === trigger && (t.is_default || charge.creditor.creditor_profile?.message_templates.length === 1)
      );

      const message = this.buildAutomaticMessage(charge, trigger, template?.body);
      
      try {
        await this.whatsapp.sendText(charge.debtor.phone, message);
        
        await this.prisma.messageHistory.create({
          data: {
            charge_id: charge.id,
            trigger_type: type,
            status: 'SENT',
            zapi_message_id: 'AUTO_' + Math.random().toString(36).substring(7),
          }
        });

        this.logger.log(`Notificação ${trigger} enviada: ${charge.debtor.name}`);
      } catch (err) {
        this.logger.error(`Erro no disparo automático para cobrança ${charge.id}:`, err);
      }
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

    // Fallback para mensagens padrão do sistema (Regras de Ouro)
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
