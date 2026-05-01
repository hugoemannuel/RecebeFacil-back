import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlanType } from '@prisma/client';
import { PLAN_MODULES } from '../common/plan-modules';
import { AsaasService } from '../integrations/asaas.service';

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private prisma: PrismaService,
    private asaasService: AsaasService,
  ) {}

  /**
   * Retorna o plano ativo do usuário.
   * Se não tiver assinatura ou estiver vencida, retorna FREE.
   */
  async getUserPlan(userId: string): Promise<PlanType> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { user_id: userId },
    });

    if (subscription?.status === 'ACTIVE') return subscription.plan_type;

    if (
      subscription?.status === 'CANCELED' && 
      subscription?.current_period_end && 
      subscription.current_period_end > new Date()
    ) {
      return subscription.plan_type;
    }

    return PlanType.FREE;
  }

  /**
   * Retorna o status completo da assinatura para exibir no front-end.
   */
  async getSubscriptionStatus(userId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { user_id: userId },
    });

    const now = new Date();
    const currentPeriodEnd = subscription?.current_period_end;
    
    const cancelAtPeriodEnd =
      subscription?.status === 'CANCELED' &&
      currentPeriodEnd &&
      currentPeriodEnd > now;

    const plan: PlanType =
      subscription?.status === 'ACTIVE' ||
      (subscription?.status === 'CANCELED' && currentPeriodEnd && currentPeriodEnd > now)
        ? subscription!.plan_type
        : PlanType.FREE;

    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const sentThisMonth = await this.prisma.charge.count({
      where: { creditor_id: userId, created_at: { gte: startOfMonth } },
    });

    return {
      plan,
      status: subscription?.status ?? 'NONE',
      period: subscription?.period ?? null,
      current_period_end: subscription?.current_period_end ?? null,
      cancel_at_period_end: !!cancelAtPeriodEnd,
      payment_failed: !!subscription?.payment_failed_at,
      payment_failed_at: subscription?.payment_failed_at ?? null,
      allowed_modules: PLAN_MODULES[plan],
      sentThisMonth,
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
   * Cancela a assinatura do usuário mantendo acesso até o fim do período pago.
   */
  async cancelSubscription(userId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { user_id: userId },
    });

    if (!subscription || subscription.status !== 'ACTIVE') {
      throw new BadRequestException('Nenhuma assinatura ativa encontrada.');
    }

    const updated = await this.prisma.subscription.update({
      where: { user_id: userId },
      data: { status: 'CANCELED' },
    });

    await this.prisma.auditLog.create({
      data: {
        user_id: userId,
        action: 'SUBSCRIPTION_CANCELED',
        entity: 'Subscription',
        entity_id: subscription.id,
        details: { plan_type: subscription.plan_type, current_period_end: subscription.current_period_end },
      },
    });

    return {
      cancel_at_period_end: true,
      current_period_end: updated.current_period_end,
    };
  }

  /**
   * Registra falha de pagamento e inicia grace period de 4 dias.
   * Chamado pelo webhook PAYMENT_OVERDUE do Asaas.
   */
  async recordPaymentFailure(userId: string, reason: string) {
    const subscription = await this.prisma.subscription.findUnique({ where: { user_id: userId } });
    if (!subscription) return;

    await this.prisma.subscription.update({
      where: { user_id: userId },
      data: {
        status: 'OVERDUE',
        payment_failed_at: new Date(),
        payment_failure_reason: reason,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        user_id: userId,
        action: 'PAYMENT_FAILED',
        entity: 'Subscription',
        entity_id: subscription.id,
        details: { reason, grace_period_days: 4 },
      },
    });
  }

  /**
   * Limpa falha de pagamento após confirmação do Asaas.
   */
  async clearPaymentFailure(userId: string) {
    await this.prisma.subscription.update({
      where: { user_id: userId },
      data: {
        status: 'ACTIVE',
        payment_failed_at: null,
        payment_failure_reason: null,
      },
    });
  }

  /**
   * CRON diário: cancela assinaturas em OVERDUE há mais de 4 dias.
   */
  async cancelOverdueSubscriptions() {
    const gracePeriodCutoff = new Date();
    gracePeriodCutoff.setDate(gracePeriodCutoff.getDate() - 4);

    const overdueSubscriptions = await this.prisma.subscription.findMany({
      where: {
        status: 'OVERDUE',
        payment_failed_at: { lte: gracePeriodCutoff },
      },
    });

    for (const sub of overdueSubscriptions) {
      await this.downgradeToFree(sub.user_id, 'GRACE_PERIOD_EXPIRED');
    }

    return overdueSubscriptions.length;
  }

  /**
   * Rebaixa o usuário para FREE.
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

  /**
   * Gera o link de checkout real do Asaas.
   */
  async createCheckout(userId: string, planType: PlanType, period: 'MONTHLY' | 'YEARLY', document?: string) {
    const checkout = await this.asaasService.createPlanSubscription(userId, planType, period, document);
    
    if (checkout.asaasId) {
      const isAlreadyActive = checkout.status === 'ACTIVE';
      const now = new Date();
      const periodEnd = new Date(now);
      if (period === 'YEARLY') periodEnd.setFullYear(periodEnd.getFullYear() + 1);
      else periodEnd.setMonth(periodEnd.getMonth() + 1);

      await this.prisma.subscription.upsert({
        where: { user_id: userId },
        update: {
          asaas_id: checkout.asaasId,
          plan_type: planType,
          period,
          status: isAlreadyActive ? 'ACTIVE' : 'PENDING',
          ...(isAlreadyActive && {
            last_payment_at: now,
            current_period_start: now,
            current_period_end: periodEnd,
          }),
        },
        create: {
          user_id: userId,
          asaas_id: checkout.asaasId,
          plan_type: planType,
          period,
          status: isAlreadyActive ? 'ACTIVE' : 'PENDING',
          ...(isAlreadyActive && {
            last_payment_at: now,
            current_period_start: now,
            current_period_end: periodEnd,
          }),
        },
      });

      if (isAlreadyActive) {
        this.logger.log(`Plano ${planType} ativado imediatamente para usuário ${userId} (Asaas status: ACTIVE)`);
      }
    }

    return checkout;
  }

  /**
   * Marca assinatura como OVERDUE via webhook do Asaas (usando asaas_id da assinatura).
   */
  async recordOverdueByAsaasId(asaasId: string, reason: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { asaas_id: asaasId },
    });
    if (!subscription) {
      this.logger.warn(`Assinatura não encontrada para overdue. Asaas ID: ${asaasId}`);
      return;
    }
    await this.recordPaymentFailure(subscription.user_id, reason);
  }

  /**
   * Ativa a assinatura do usuário quando o webhook do Asaas confirma o pagamento.
   */
  async activateSubscriptionByAsaasId(asaasId: string) {
    this.logger.log(`Buscando assinatura no banco com Asaas ID: ${asaasId}`);
    const subscription = await this.prisma.subscription.findFirst({
      where: { asaas_id: asaasId }
    });

    if (!subscription) {
      this.logger.warn(`Assinatura não encontrada para o Asaas ID: ${asaasId}`);
      return;
    }

    this.logger.log(`Assinatura encontrada! Usuário: ${subscription.user_id}. Ativando...`);

    // Calcular data de expiração com margem (32 dias)
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + 32);

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: 'ACTIVE',
        last_payment_at: now,
        current_period_start: now,
        current_period_end: expiresAt,
      }
    });

    await this.prisma.auditLog.create({
      data: {
        user_id: subscription.user_id,
        action: 'SUBSCRIPTION_ACTIVATED',
        entity: 'Subscription',
        entity_id: subscription.id,
        details: { asaasId }
      }
    });
  }
}
