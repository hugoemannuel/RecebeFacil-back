import { Injectable, ForbiddenException, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ClientsService } from '../clients/clients.service';
import { AsaasService } from '../integrations/asaas.service';
import { WhatsAppService, ZApiCredentials } from '../whatsapp/whatsapp.service';
import { CreateChargeDto } from './dto/create-charge.dto';
import { UpdateRecurringChargeDto } from './dto/update-recurring-charge.dto';
import { AutomateChargeDto } from './dto/automate-charge.dto';
import { PixKeyType, TriggerType } from '@prisma/client';
import { canSaveMoreTemplates } from '../common/plan-modules';
import { startOfDay } from 'date-fns';
import { PgBossService, NOTIFICATION_QUEUE } from '../queue/pg-boss.service';

@Injectable()
export class ChargesService {
  private readonly logger = new Logger(ChargesService.name);

  constructor(
    private prisma: PrismaService,
    private clientsService: ClientsService,
    private pgBoss: PgBossService,
    private asaasService: AsaasService,
    private whatsapp: WhatsAppService,
  ) {}

  async findAll(userId: string) {
    const charges = await this.prisma.charge.findMany({
      where: { creditor_id: userId },
      include: {
        debtor: true,
        recurring_charge: true,
      },
      orderBy: {
        created_at: 'desc',
      },
    });

    return charges.map(charge => ({
      id: charge.id,
      debtorName: charge.debtor.name,
      phone: charge.debtor.phone,
      amount: charge.amount,
      dueDate: charge.due_date.toISOString().split('T')[0],
      status: charge.status,
      recurrence: charge.recurring_charge?.frequency ?? 'ONCE',
      automationEnabled: !!charge.recurring_charge_id,
      recurringChargeId: charge.recurring_charge_id ?? null,
      is_intermediated: charge.is_intermediated,
      asaas_invoice_url: charge.asaas_invoice_url ?? null,
    }));
  }

  async findAllRecurring(userId: string) {
    const rules = await this.prisma.recurringCharge.findMany({
      where: { creditor_id: userId },
      include: {
        debtors: { include: { debtor: true } },
        _count: { select: { charges: true } }
      },
      orderBy: { created_at: 'desc' }
    });
 
    return rules.map(rule => ({
      id: rule.id,
      amount: rule.amount,
      description: rule.description,
      frequency: rule.frequency,
      nextGenerationDate: rule.next_generation_date,
      active: rule.active,
      debtorName: rule.debtors[0]?.debtor.name || 'Vários',
      totalGenerated: rule._count.charges,
      custom_message: rule.custom_message ?? null,
    }));
  }

  async findOne(userId: string, chargeId: string) {
    const charge = await this.prisma.charge.findUnique({
      where: { id: chargeId },
      include: {
        debtor: true,
        messages: {
          orderBy: { sent_at: 'desc' }
        }
      }
    });

    if (!charge || charge.creditor_id !== userId) {
      throw new ForbiddenException('Charge not found or access denied');
    }

    return charge;
  }

  async createCharge(userId: string, dto: CreateChargeDto) {
    // 1. Verify Plan & Limit
    const subscription = await this.prisma.subscription.findUnique({
      where: { user_id: userId },
    });
    
    if (!subscription || subscription.status !== 'ACTIVE') {
      throw new ForbiddenException('Assinatura inativa ou não encontrada.');
    }

    const planLimits = { FREE: 10, STARTER: 50, PRO: 200, UNLIMITED: 999999 };
    const limit = planLimits[subscription.plan_type] || 0;

    const allowedRecurrences: Record<string, string[]> = {
      FREE:      ['ONCE'],
      STARTER:   ['ONCE', 'MONTHLY'],
      PRO:       ['ONCE', 'WEEKLY', 'MONTHLY', 'YEARLY'],
      UNLIMITED: ['ONCE', 'WEEKLY', 'MONTHLY', 'YEARLY'],
    };

    if (!allowedRecurrences[subscription.plan_type]?.includes(dto.recurrence)) {
      throw new ForbiddenException('RECURRENCE_NOT_ALLOWED');
    }

    const currentMonthStart = new Date();
    currentMonthStart.setDate(1);
    currentMonthStart.setHours(0,0,0,0);

    const chargeCount = await this.prisma.charge.count({
      where: {
        creditor_id: userId,
        created_at: { gte: currentMonthStart },
      },
    });

    if (chargeCount >= limit) {
      throw new ForbiddenException('LIMIT_REACHED');
    }

    // 1.5 Validate split prerequisites
    if (dto.is_intermediated) {
      if (!['PRO', 'UNLIMITED'].includes(subscription.plan_type)) {
        throw new ForbiddenException('SPLIT_PLAN_REQUIRED');
      }
      const integrationConfig = await this.prisma.integrationConfig.findUnique({ where: { user_id: userId } });
      if (!integrationConfig?.split_terms_accepted_at) {
        throw new ForbiddenException('SPLIT_TERMS_NOT_ACCEPTED');
      }
    }

    // 2. Update Creditor Profile if Pix Key was provided inline
    if (dto.send_pix_button && dto.pix_key && dto.pix_key_type) {
      await this.prisma.creditorProfile.upsert({
        where: { user_id: userId },
        update: {
          pix_key: dto.pix_key,
          pix_key_type: dto.pix_key_type as PixKeyType,
        },
        create: {
          user_id: userId,
          pix_key: dto.pix_key,
          pix_key_type: dto.pix_key_type as PixKeyType,
        },
      });
      // Registrar log de auditoria
      await this.prisma.auditLog.create({
        data: {
          user_id: userId,
          action: 'PIX_CONFIG_UPDATED',
          entity: 'CreditorProfile',
          entity_id: userId,
        }
      });
    }

    // 3. Find or Create Debtor User (Shadow User)
    let debtor = await this.prisma.user.findUnique({
      where: { phone: dto.debtor_phone },
    });

    if (!debtor) {
      debtor = await this.prisma.user.create({
        data: {
          phone: dto.debtor_phone,
          name: dto.debtor_name,
          is_registered: false,
        },
      });
    }

    // 4. Create RecurringCharge (if recurring) + Charge
    let recurringChargeId: string | null = null;

    if (dto.recurrence !== 'ONCE') {
      const dueDate = new Date(dto.due_date);
      const nextGenerationDate = this.calcNextDate(dueDate, dto.recurrence);

      const recurringCharge = await this.prisma.recurringCharge.create({
        data: {
          creditor_id: userId,
          amount: dto.amount,
          description: dto.description,
          frequency: dto.recurrence as any,
          next_generation_date: nextGenerationDate,
          active: true,
          custom_message: dto.custom_message,
          max_installments: dto.max_installments ?? null,
          debtors: { create: { debtor_id: debtor.id } },
        },
      });
      recurringChargeId = recurringCharge.id;
    }

    const charge = await this.prisma.charge.create({
      data: {
        creditor_id: userId,
        debtor_id: debtor.id,
        amount: dto.amount,
        description: dto.description,
        due_date: new Date(dto.due_date),
        custom_message: dto.custom_message,
        status: 'PENDING',
        recurring_charge_id: recurringChargeId,
      },
    });

    // 4.5 Create Asaas payment if intermediated
    let asaasInvoiceUrl: string | undefined;
    if (dto.is_intermediated) {
      const platformFeePct = subscription.plan_type === 'UNLIMITED' ? 1.0 : 2.0;
      try {
        const asaasResult = await this.asaasService.createIntermediatedPayment({
          debtorName: debtor.name,
          debtorPhone: debtor.phone,
          amountCentavos: dto.amount,
          dueDate: new Date(dto.due_date),
          description: dto.description,
          chargeId: charge.id,
        });
        await this.prisma.charge.update({
          where: { id: charge.id },
          data: {
            is_intermediated: true,
            platform_fee_pct: platformFeePct,
            asaas_payment_id: asaasResult.asaasPaymentId,
            asaas_invoice_url: asaasResult.invoiceUrl,
          },
        });
        asaasInvoiceUrl = asaasResult.invoiceUrl;
      } catch (e) {
        await this.prisma.charge.delete({ where: { id: charge.id } });
        throw e;
      }
    }

    // 5. Enviar WhatsApp com a mensagem customizada
    let whatsappStatus = 'PENDING';
    let whatsappErrorDetails: string | undefined;
    let zapiMessageId: string | undefined;

    if (!dto.is_intermediated) {
      // Busca perfil e config do credor para construir a mensagem
      const [creditorProfile, integrationConfig] = await Promise.all([
        this.prisma.creditorProfile.findUnique({ where: { user_id: userId } }),
        this.prisma.integrationConfig.findUnique({ where: { user_id: userId } }),
      ]);

      const dueDate = new Date(dto.due_date);
      const dueDateStr = dueDate.toLocaleDateString('pt-BR');
      const amountStr = (dto.amount / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      const businessName = creditorProfile?.business_name || debtor.name;

      let message = (dto.custom_message || '')
        .replace(/{{nome}}/g, debtor.name)
        .replace(/{{valor}}/g, amountStr)
        .replace(/{{vencimento}}/g, dueDateStr)
        .replace(/{{descricao}}/g, dto.description || '')
        .replace(/{{nome_empresa}}/g, businessName);

      // Append chave PIX do perfil se configurada
      if (creditorProfile?.pix_key) {
        message += `\n\n💰 *Chave PIX (${creditorProfile.pix_key_type ?? 'PIX'}):*\n${creditorProfile.pix_key}`;
      }

      const credentials: ZApiCredentials | undefined =
        integrationConfig?.zapi_instance_id && integrationConfig?.zapi_instance_token
          ? {
              instanceId: integrationConfig.zapi_instance_id,
              token: integrationConfig.zapi_instance_token,
              clientToken: process.env.ZAPI_CLIENT_TOKEN ?? '',
            }
          : undefined;

      try {
        await this.whatsapp.sendText(debtor.phone, message, credentials);
        whatsappStatus = 'SENT';
      } catch (err) {
        whatsappStatus = 'FAILED';
        whatsappErrorDetails = err instanceof Error ? err.message : String(err);
        this.logger.warn(`WhatsApp falhou para cobrança ${charge.id}: ${whatsappErrorDetails}`);
      }
    }

    await this.prisma.messageHistory.create({
      data: {
        charge_id: charge.id,
        trigger_type: 'MANUAL',
        status: whatsappStatus,
        zapi_message_id: zapiMessageId,
        error_details: whatsappErrorDetails,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        user_id: userId,
        action: 'CHARGE_CREATED',
        entity: 'Charge',
        entity_id: charge.id,
      }
    });

    // 6. Opcional: Salvar como Template
    if (dto.save_as_template && dto.template_name) {
      const profile = await this.prisma.creditorProfile.findUnique({
        where: { user_id: userId },
      });
      
      if (profile && subscription.plan_type !== 'FREE') {
        // Validar limite
        const currentCount = await this.prisma.messageTemplate.count({
          where: { creditor_profile_id: profile.id },
        });

        if (canSaveMoreTemplates(subscription.plan_type, currentCount)) {
          await this.prisma.messageTemplate.create({
            data: {
              creditor_profile_id: profile.id,
              name: dto.template_name,
              body: dto.custom_message,
              trigger: 'MANUAL',
            },
          });
        }
      }
    }

    // Mantém a lista de clientes sincronizada
    await this.clientsService.upsertFromCharge(userId, debtor.id);

    return { success: true, chargeId: charge.id, ...(asaasInvoiceUrl ? { asaas_invoice_url: asaasInvoiceUrl } : {}) };
  }

  async updateChargeStatus(userId: string, chargeId: string, status: 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELED') {
    const charge = await this.prisma.charge.findUnique({ where: { id: chargeId } });
    if (!charge) throw new NotFoundException('Cobrança não encontrada.');
    if (charge.creditor_id !== userId) throw new ForbiddenException();

    await this.prisma.charge.update({
      where: { id: chargeId },
      data: {
        status,
        payment_date: status === 'PAID' ? new Date() : null,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        user_id: userId,
        action: 'CHARGE_STATUS_UPDATED',
        entity: 'Charge',
        entity_id: chargeId,
        details: { from: charge.status, to: status },
      },
    });

    return { success: true };
  }

  async hardDeleteCharge(userId: string, chargeId: string) {
    const charge = await this.prisma.charge.findUnique({ where: { id: chargeId } });
    if (!charge) throw new NotFoundException('Cobrança não encontrada.');
    if (charge.creditor_id !== userId) throw new ForbiddenException();

    await this.prisma.charge.delete({ where: { id: chargeId } });

    await this.prisma.auditLog.create({
      data: { user_id: userId, action: 'CHARGE_DELETED', entity: 'Charge', entity_id: chargeId },
    });

    return { success: true };
  }

  async cancelCharge(userId: string, chargeId: string) {
    const charge = await this.prisma.charge.findUnique({ where: { id: chargeId } });
    if (!charge || charge.creditor_id !== userId) throw new ForbiddenException();
    
    await this.prisma.charge.update({
      where: { id: chargeId },
      data: { status: 'CANCELED' }
    });

    await this.prisma.auditLog.create({
      data: { user_id: userId, action: 'CHARGE_CANCELED', entity: 'Charge', entity_id: chargeId }
    });
    return { success: true };
  }

  async bulkCancel(userId: string, chargeIds: string[]) {
    const subscription = await this.prisma.subscription.findUnique({ where: { user_id: userId } });
    if (!subscription || ['FREE', 'STARTER'].includes(subscription.plan_type)) {
      throw new ForbiddenException('Ações em massa requerem plano PRO ou superior.');
    }

    const charges = await this.prisma.charge.findMany({
      where: { id: { in: chargeIds }, creditor_id: userId }
    });
    
    const validIds = charges.map(c => c.id);
    if (validIds.length === 0) return { success: true, count: 0 };

    await this.prisma.charge.updateMany({
      where: { id: { in: validIds } },
      data: { status: 'CANCELED' }
    });

    for (const id of validIds) {
      await this.prisma.auditLog.create({
        data: { user_id: userId, action: 'CHARGE_BULK_CANCELED', entity: 'Charge', entity_id: id }
      });
    }

    return { success: true, count: validIds.length };
  }

  private calcNextDate(from: Date, recurrence: string): Date {
    const d = new Date(from);
    if (recurrence === 'WEEKLY') d.setDate(d.getDate() + 7);
    else if (recurrence === 'MONTHLY') d.setMonth(d.getMonth() + 1);
    else if (recurrence === 'YEARLY') d.setFullYear(d.getFullYear() + 1);
    return d;
  }

  async bulkRemind(userId: string, chargeIds: string[]) {
    const subscription = await this.prisma.subscription.findUnique({ where: { user_id: userId } });
    if (!subscription || ['FREE', 'STARTER'].includes(subscription.plan_type)) {
      throw new ForbiddenException('Ações em massa requerem plano PRO ou superior.');
    }

    // Just simulating a bulk remind for now
    const charges = await this.prisma.charge.findMany({
      where: { id: { in: chargeIds }, creditor_id: userId }
    });

    const validIds = charges.map(c => c.id);
    if (validIds.length === 0) return { success: true, count: 0 };

    // Fake background job
    for (const id of validIds) {
      await this.prisma.messageHistory.create({
        data: { charge_id: id, trigger_type: 'MANUAL', status: 'SENT' }
      });
    }

    return { success: true, count: validIds.length };
  }
 
  async findOneRecurring(userId: string, ruleId: string) {
    const rule = await this.prisma.recurringCharge.findUnique({
      where: { id: ruleId },
      include: { debtors: { include: { debtor: true } } },
    });
    if (!rule || rule.creditor_id !== userId) throw new ForbiddenException();

    return {
      id: rule.id,
      amount: rule.amount,
      description: rule.description,
      frequency: rule.frequency,
      nextGenerationDate: rule.next_generation_date,
      custom_message: rule.custom_message ?? null,
      max_installments: rule.max_installments ?? null,
      debtorName: rule.debtors[0]?.debtor.name || 'Vários',
    };
  }

  async cancelRecurring(userId: string, ruleId: string) {
    const rule = await this.prisma.recurringCharge.findUnique({ where: { id: ruleId } });
    if (!rule || rule.creditor_id !== userId) throw new ForbiddenException();

    await this.prisma.recurringCharge.update({
      where: { id: ruleId },
      data: { active: false }
    });

    return { success: true };
  }

  async updateRecurring(userId: string, ruleId: string, dto: UpdateRecurringChargeDto) {
    const rule = await this.prisma.recurringCharge.findUnique({ where: { id: ruleId } });
    if (!rule) throw new NotFoundException('Regra não encontrada.');
    if (rule.creditor_id !== userId) throw new ForbiddenException();

    const data: any = {};
    if (dto.frequency !== undefined) data.frequency = dto.frequency;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.custom_message !== undefined) data.custom_message = dto.custom_message;
    if (dto.next_generation_date !== undefined) data.next_generation_date = new Date(dto.next_generation_date);
    if (dto.max_installments !== undefined) data.max_installments = dto.max_installments;

    const updated = await this.prisma.recurringCharge.update({
      where: { id: ruleId },
      data,
    });

    await this.prisma.auditLog.create({
      data: {
        user_id: userId,
        action: 'RECURRING_CHARGE_UPDATED',
        entity: 'RecurringCharge',
        entity_id: ruleId,
        details: { ...dto },
      },
    });

    return { success: true, data: updated };
  }

  async deleteRecurring(userId: string, ruleId: string) {
    const rule = await this.prisma.recurringCharge.findUnique({ where: { id: ruleId } });
    if (!rule) throw new NotFoundException('Regra não encontrada.');
    if (rule.creditor_id !== userId) throw new ForbiddenException();

    await this.prisma.recurringCharge.delete({ where: { id: ruleId } });

    await this.prisma.auditLog.create({
      data: {
        user_id: userId,
        action: 'RECURRING_CHARGE_DELETED',
        entity: 'RecurringCharge',
        entity_id: ruleId,
      },
    });

    return { success: true };
  }

  async reactivateRecurring(userId: string, ruleId: string) {
    const rule = await this.prisma.recurringCharge.findUnique({ where: { id: ruleId } });
    if (!rule) throw new NotFoundException('Regra não encontrada.');
    if (rule.creditor_id !== userId) throw new ForbiddenException();

    await this.prisma.recurringCharge.update({
      where: { id: ruleId },
      data: { active: true },
    });

    await this.prisma.auditLog.create({
      data: {
        user_id: userId,
        action: 'RECURRING_CHARGE_REACTIVATED',
        entity: 'RecurringCharge',
        entity_id: ruleId,
      },
    });

    return { success: true };
  }

  async automateCharge(userId: string, chargeId: string, dto: AutomateChargeDto) {
    const charge = await this.prisma.charge.findUnique({
      where: { id: chargeId },
      include: { debtor: true },
    });
    if (!charge || charge.creditor_id !== userId) throw new ForbiddenException();
    if (charge.recurring_charge_id) throw new ForbiddenException('Cobrança já possui automação configurada.');

    const recurringCharge = await this.prisma.recurringCharge.create({
      data: {
        creditor_id: userId,
        amount: charge.amount,
        description: charge.description,
        frequency: dto.frequency as any,
        next_generation_date: new Date(dto.next_generation_date),
        active: true,
        custom_message: dto.custom_message ?? charge.custom_message,
        max_installments: dto.max_installments ?? null,
        debtors: { create: { debtor_id: charge.debtor_id } },
      },
    });

    await this.prisma.charge.update({
      where: { id: chargeId },
      data: { recurring_charge_id: recurringCharge.id },
    });

    await this.prisma.auditLog.create({
      data: {
        user_id: userId,
        action: 'RECURRING_CHARGE_CREATED',
        entity: 'RecurringCharge',
        entity_id: recurringCharge.id,
      },
    });

    return { success: true, recurringChargeId: recurringCharge.id };
  }

  async notifyNow(userId: string, chargeId: string, trigger: 'BEFORE_DUE' | 'ON_DUE' | 'OVERDUE') {
    const charge = await this.prisma.charge.findUnique({ where: { id: chargeId } });
    if (!charge || charge.creditor_id !== userId) throw new ForbiddenException();

    const today = startOfDay(new Date());
    const alreadySent = await this.prisma.messageHistory.findFirst({
      where: { charge_id: chargeId, trigger_type: TriggerType.MANUAL, sent_at: { gte: today } },
    });
    if (alreadySent) throw new ConflictException('Notificação manual já enviada hoje para esta cobrança.');

    await this.pgBoss.send(NOTIFICATION_QUEUE, { chargeId, trigger }, {
      singletonKey: `${chargeId}-manual`,
    });

    return { queued: true };
  }
}
