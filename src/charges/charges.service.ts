import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChargeDto } from './dto/create-charge.dto';
import { PixKeyType } from '@prisma/client';

@Injectable()
export class ChargesService {
  constructor(private prisma: PrismaService) {}

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

    // 4. Create Charge
    const charge = await this.prisma.charge.create({
      data: {
        creditor_id: userId,
        debtor_id: debtor.id,
        amount: dto.amount,
        description: dto.description,
        due_date: new Date(dto.due_date),
        custom_message: dto.custom_message,
        status: 'PENDING',
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

    // Em um sistema real, aqui chamaria um serviço em background/filas (Ex: BullMQ)
    // para disparar a API da Z-API caso o plano permita e o status seja PENDING

    return { success: true, chargeId: charge.id };
  }
}
