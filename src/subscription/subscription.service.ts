import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlanType } from '@prisma/client';
import { PLAN_MODULES } from '../common/plan-modules';

@Injectable()
export class SubscriptionService {
  constructor(private prisma: PrismaService) {}

  /**
   * Retorna o plano ativo do usuário.
   * Se não tiver assinatura ou estiver vencida, retorna FREE.
   */
  async getUserPlan(userId: string): Promise<PlanType> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { user_id: userId },
    });

    if (!subscription || subscription.status !== 'ACTIVE') {
      return PlanType.FREE;
    }

    return subscription.plan_type;
  }

  /**
   * Retorna o status completo da assinatura para exibir no front-end.
   */
  async getSubscriptionStatus(userId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { user_id: userId },
    });

    const plan: PlanType =
      subscription?.status === 'ACTIVE'
        ? subscription.plan_type
        : PlanType.FREE;

    return {
      plan,
      status: subscription?.status ?? 'NONE',
      period: subscription?.period ?? null,
      current_period_end: subscription?.current_period_end ?? null,
      allowed_modules: PLAN_MODULES[plan],
    };
  }

  /**
   * Cria ou atualiza a assinatura do usuário (chamado pelo webhook do Asaas).
   */
  async activatePlan(
    userId: string,
    planType: PlanType,
    period: 'MONTHLY' | 'YEARLY',
    asaas_payment_id: string,
  ) {
    const now = new Date();
    const periodEnd = new Date(now);
    if (period === 'YEARLY') {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    const subscription = await this.prisma.subscription.upsert({
      where: { user_id: userId },
      update: {
        plan_type: planType,
        status: 'ACTIVE',
        period,
        current_period_start: now,
        current_period_end: periodEnd,
        asaas_payment_id,
      },
      create: {
        user_id: userId,
        plan_type: planType,
        status: 'ACTIVE',
        period,
        current_period_start: now,
        current_period_end: periodEnd,
        asaas_payment_id,
      },
    });

    // Auditoria
    await this.prisma.auditLog.create({
      data: {
        user_id: userId,
        action: 'SUBSCRIPTION_ACTIVATED',
        entity: 'Subscription',
        entity_id: subscription.id,
        details: { plan_type: planType, period, asaas_payment_id },
      },
    });

    return subscription;
  }

  /**
   * Rebaixa o usuário para FREE (chamado quando pagamento falha ou é cancelado).
   */
  async downgradeToFree(userId: string, reason: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { user_id: userId },
    });

    if (!subscription) return;

    const updated = await this.prisma.subscription.update({
      where: { user_id: userId },
      data: { status: 'CANCELED' },
    });

    await this.prisma.auditLog.create({
      data: {
        user_id: userId,
        action: 'SUBSCRIPTION_DOWNGRADED',
        entity: 'Subscription',
        entity_id: updated.id,
        details: { reason },
      },
    });
  }
}
