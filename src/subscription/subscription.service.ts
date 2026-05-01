import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
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
   * Também aceita cancelamento em status OVERDUE (grace period).
   */
  async cancelSubscription(userId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { user_id: userId },
    });

    if (!subscription || !['ACTIVE', 'OVERDUE'].includes(subscription.status)) {
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
   * CRON diário à meia-noite: cancela assinaturas em OVERDUE há mais de 4 dias.
   */
  @Cron('0 0 * * *')
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
      await this.prisma.subscription.upsert({
        where: { user_id: userId },
        update: {
          asaas_id: checkout.asaasId,
          plan_type: planType,
          period,
          status: 'PENDING',
        },
        create: {
          user_id: userId,
          asaas_id: checkout.asaasId,
          plan_type: planType,
          period,
          status: 'PENDING',
        },
      });
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
   * Ativa a assinatura quando o webhook do Asaas confirma o pagamento.
   * Idempotente: ignora se o mesmo payment_id já foi processado.
   */
  async activateSubscriptionByAsaasId(asaasId: string, paymentId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { asaas_id: asaasId },
    });

    if (!subscription) {
      this.logger.warn(`Assinatura não encontrada para o Asaas ID: ${asaasId}`);
      return;
    }

    if (subscription.asaas_payment_id === paymentId) {
      this.logger.log(`Webhook duplicado ignorado. Payment ID: ${paymentId}`);
      return;
    }

    const now = new Date();
    const expiresAt = new Date(now);
    if (subscription.period === 'YEARLY') {
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      expiresAt.setDate(expiresAt.getDate() + 2); // margem de 2 dias
    } else {
      expiresAt.setDate(expiresAt.getDate() + 32); // ~1 mês + 2 dias de margem
    }

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: 'ACTIVE',
        asaas_payment_id: paymentId,
        last_payment_at: now,
        current_period_start: now,
        current_period_end: expiresAt,
        payment_failed_at: null,
        payment_failure_reason: null,
      },
    });

    this.logger.log(`Assinatura ${asaasId} ativada. Usuário: ${subscription.user_id}. Expira: ${expiresAt.toISOString()}`);

    await this.prisma.auditLog.create({
      data: {
        user_id: subscription.user_id,
        action: 'SUBSCRIPTION_ACTIVATED',
        entity: 'Subscription',
        entity_id: subscription.id,
        details: { asaasId, paymentId, period: subscription.period },
      },
    });
  }

  /**
   * Rebaixa para FREE via webhook PAYMENT_DELETED ou PAYMENT_REFUNDED.
   */
  async downgradeByAsaasId(asaasId: string, reason: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { asaas_id: asaasId },
    });

    if (!subscription) {
      this.logger.warn(`Assinatura não encontrada para downgrade. Asaas ID: ${asaasId}`);
      return;
    }

    await this.downgradeToFree(subscription.user_id, reason);
  }
}
