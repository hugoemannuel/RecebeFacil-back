import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ClientsService } from '../clients/clients.service';
import { CreateChargeDto } from './dto/create-charge.dto';
import { UpdateRecurringChargeDto } from './dto/update-recurring-charge.dto';
import { PixKeyType } from '@prisma/client';
import { canSaveMoreTemplates } from '../common/plan-modules';

@Injectable()
export class ChargesService {
  constructor(
    private prisma: PrismaService,
    private clientsService: ClientsService,
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
      FREE: ['ONCE'],
      STARTER: ['ONCE', 'WEEKLY'],
      PRO: ['ONCE', 'WEEKLY', 'MONTHLY', 'YEARLY'],
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

    // 5. Create MessageHistory
    await this.prisma.messageHistory.create({
      data: {
        charge_id: charge.id,
        trigger_type: 'MANUAL',
        status: 'PENDING',
      }
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

    // Em um sistema real, aqui chamaria um serviço em background/filas (Ex: BullMQ)
    // para disparar a API da Z-API caso o plano permita e o status seja PENDING

    return { success: true, chargeId: charge.id };
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
}
