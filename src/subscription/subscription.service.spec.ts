import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { PrismaService } from '../prisma/prisma.service';
import { AsaasService } from '../integrations/asaas.service';
import { PlanType } from '@prisma/client';
import { PLAN_MODULES } from '../common/plan-modules';

describe('SubscriptionService', () => {
  let service: SubscriptionService;

  const mockPrisma = {
    subscription: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    charge: { count: jest.fn() },
    auditLog: { create: jest.fn() },
  };

  const mockAsaasService = {
    createPlanSubscription: jest.fn(),
    cancelSubscription: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AsaasService, useValue: mockAsaasService },
      ],
    }).compile();
    service = module.get<SubscriptionService>(SubscriptionService);
  });

  afterEach(() => jest.clearAllMocks());

  it('deve estar definido', () => expect(service).toBeDefined());

  // ─── getUserPlan ──────────────────────────────────────────────
  describe('getUserPlan', () => {
    it('deve retornar FREE quando não há assinatura', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce(null);
      expect(await service.getUserPlan('user-1')).toBe(PlanType.FREE);
    });

    it('deve retornar FREE quando assinatura está CANCELED e período expirou', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce({
        plan_type: PlanType.PRO, status: 'CANCELED',
        current_period_end: new Date('2020-01-01'),
      });
      expect(await service.getUserPlan('user-1')).toBe(PlanType.FREE);
    });

    it('deve retornar plano quando assinatura CANCELED mas período ainda vigente', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce({
        plan_type: PlanType.PRO, status: 'CANCELED',
        current_period_end: new Date('2099-01-01'),
      });
      expect(await service.getUserPlan('user-1')).toBe(PlanType.PRO);
    });

    it('deve retornar FREE quando assinatura está OVERDUE', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce({
        plan_type: PlanType.STARTER, status: 'OVERDUE',
      });
      expect(await service.getUserPlan('user-1')).toBe(PlanType.FREE);
    });

    it('deve retornar plano correto quando ACTIVE', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce({
        plan_type: PlanType.PRO, status: 'ACTIVE',
      });
      expect(await service.getUserPlan('user-1')).toBe(PlanType.PRO);
    });
  });

  // ─── getSubscriptionStatus ────────────────────────────────────
  describe('getSubscriptionStatus', () => {
    it('deve retornar status NONE e módulos FREE sem assinatura', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce(null);
      mockPrisma.charge.count.mockResolvedValueOnce(3);

      const result = await service.getSubscriptionStatus('user-1');
      expect(result.plan).toBe(PlanType.FREE);
      expect(result.status).toBe('NONE');
      expect(result.allowed_modules).toEqual(PLAN_MODULES[PlanType.FREE]);
      expect(result.sentThisMonth).toBe(3);
    });

    it('deve retornar módulos do plano STARTER quando ACTIVE', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce({
        plan_type: PlanType.STARTER, status: 'ACTIVE',
        period: 'MONTHLY', current_period_end: new Date('2099-12-31'),
        payment_failed_at: null,
      });
      mockPrisma.charge.count.mockResolvedValueOnce(7);

      const result = await service.getSubscriptionStatus('user-1');
      expect(result.plan).toBe(PlanType.STARTER);
      expect(result.allowed_modules).toContain('CLIENTS');
    });

    it('deve retornar módulos FREE quando CANCELED e período expirou', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce({
        plan_type: PlanType.PRO, status: 'CANCELED',
        period: 'MONTHLY', current_period_end: new Date('2020-01-01'),
        payment_failed_at: null,
      });
      mockPrisma.charge.count.mockResolvedValueOnce(0);

      const result = await service.getSubscriptionStatus('user-1');
      expect(result.plan).toBe(PlanType.FREE);
    });

    it('deve retornar cancel_at_period_end=true quando CANCELED com período vigente', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce({
        plan_type: PlanType.PRO, status: 'CANCELED',
        period: 'MONTHLY', current_period_end: new Date('2099-01-01'),
        payment_failed_at: null,
      });
      mockPrisma.charge.count.mockResolvedValueOnce(0);

      const result = await service.getSubscriptionStatus('user-1');
      expect(result.cancel_at_period_end).toBe(true);
    });

    it('deve retornar payment_failed=true quando há payment_failed_at', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce({
        plan_type: PlanType.PRO, status: 'OVERDUE',
        payment_failed_at: new Date(),
        current_period_end: null,
      });
      mockPrisma.charge.count.mockResolvedValueOnce(0);

      const result = await service.getSubscriptionStatus('user-1');
      expect(result.payment_failed).toBe(true);
    });
  });

  // ─── activatePlan ─────────────────────────────────────────────
  describe('activatePlan', () => {
    it('deve fazer upsert da assinatura e criar AuditLog', async () => {
      const sub = { id: 'sub-1', user_id: 'user-1', plan_type: PlanType.PRO, status: 'ACTIVE' };
      mockPrisma.subscription.upsert.mockResolvedValueOnce(sub);
      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      await service.activatePlan('user-1', PlanType.PRO, 'MONTHLY', 'pay_abc');

      expect(mockPrisma.subscription.upsert).toHaveBeenCalledTimes(1);
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'SUBSCRIPTION_ACTIVATED' }) }),
      );
    });

    it('deve definir current_period_end +1 mês para MONTHLY', async () => {
      mockPrisma.subscription.upsert.mockResolvedValueOnce({ id: 'sub-1' });
      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      await service.activatePlan('user-1', PlanType.STARTER, 'MONTHLY', 'pay_m');

      const call = mockPrisma.subscription.upsert.mock.calls[0][0];
      const start: Date = call.update.current_period_start;
      const end: Date = call.update.current_period_end;
      expect(end.getMonth()).toBe((start.getMonth() + 1) % 12);
    });

    it('deve definir current_period_end +1 ano para YEARLY', async () => {
      mockPrisma.subscription.upsert.mockResolvedValueOnce({ id: 'sub-1' });
      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      await service.activatePlan('user-1', PlanType.PRO, 'YEARLY', 'pay_y');

      const call = mockPrisma.subscription.upsert.mock.calls[0][0];
      const start: Date = call.update.current_period_start;
      const end: Date = call.update.current_period_end;
      expect(end.getFullYear()).toBe(start.getFullYear() + 1);
    });
  });

  // ─── cancelSubscription ───────────────────────────────────────
  describe('cancelSubscription', () => {
    it('deve cancelar assinatura ACTIVE e registrar AuditLog', async () => {
      const sub = { id: 'sub-1', status: 'ACTIVE', plan_type: PlanType.PRO, current_period_end: new Date() };
      mockPrisma.subscription.findUnique.mockResolvedValueOnce(sub);
      mockPrisma.subscription.update.mockResolvedValueOnce({ ...sub, status: 'CANCELED' });
      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      const result = await service.cancelSubscription('user-1');
      expect(result.cancel_at_period_end).toBe(true);
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'SUBSCRIPTION_CANCELED' }) }),
      );
    });

    it('deve chamar asaasService.cancelSubscription quando asaas_id existe', async () => {
      const sub = { id: 'sub-1', status: 'ACTIVE', plan_type: PlanType.PRO, current_period_end: new Date(), asaas_id: 'sub_asaas_1' };
      mockPrisma.subscription.findUnique.mockResolvedValueOnce(sub);
      mockPrisma.subscription.update.mockResolvedValueOnce({ ...sub, status: 'CANCELED' });
      mockPrisma.auditLog.create.mockResolvedValueOnce({});
      mockAsaasService.cancelSubscription.mockResolvedValueOnce(undefined);

      await service.cancelSubscription('user-1');
      expect(mockAsaasService.cancelSubscription).toHaveBeenCalledWith('sub_asaas_1');
    });

    it('deve não chamar asaasService.cancelSubscription quando asaas_id ausente', async () => {
      const sub = { id: 'sub-1', status: 'ACTIVE', plan_type: PlanType.PRO, current_period_end: new Date(), asaas_id: null };
      mockPrisma.subscription.findUnique.mockResolvedValueOnce(sub);
      mockPrisma.subscription.update.mockResolvedValueOnce({ ...sub, status: 'CANCELED' });
      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      await service.cancelSubscription('user-1');
      expect(mockAsaasService.cancelSubscription).not.toHaveBeenCalled();
    });

    it('deve cancelar assinatura OVERDUE (grace period)', async () => {
      const sub = { id: 'sub-1', status: 'OVERDUE', plan_type: PlanType.PRO, current_period_end: null };
      mockPrisma.subscription.findUnique.mockResolvedValueOnce(sub);
      mockPrisma.subscription.update.mockResolvedValueOnce({ ...sub, status: 'CANCELED' });
      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      await expect(service.cancelSubscription('user-1')).resolves.not.toThrow();
    });

    it('deve lançar BadRequestException quando não há assinatura', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce(null);
      await expect(service.cancelSubscription('user-1')).rejects.toThrow(BadRequestException);
    });

    it('deve lançar BadRequestException quando assinatura já está CANCELED', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce({ id: 'sub-1', status: 'CANCELED' });
      await expect(service.cancelSubscription('user-1')).rejects.toThrow(BadRequestException);
    });
  });

  // ─── downgradeToFree ──────────────────────────────────────────
  describe('downgradeToFree', () => {
    it('deve marcar CANCELED e registrar AuditLog', async () => {
      const sub = { id: 'sub-1', status: 'ACTIVE' };
      mockPrisma.subscription.findUnique.mockResolvedValueOnce(sub);
      mockPrisma.subscription.update.mockResolvedValueOnce({ ...sub, status: 'CANCELED' });
      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      await service.downgradeToFree('user-1', 'PAYMENT_DELETED');

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'SUBSCRIPTION_DOWNGRADED', details: { reason: 'PAYMENT_DELETED' } }),
        }),
      );
    });

    it('deve não fazer nada quando não há assinatura', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce(null);
      await service.downgradeToFree('user-1', 'TEST');
      expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
    });
  });

  // ─── recordPaymentFailure ─────────────────────────────────────
  describe('recordPaymentFailure', () => {
    it('deve marcar assinatura como OVERDUE e registrar AuditLog', async () => {
      const sub = { id: 'sub-1' };
      mockPrisma.subscription.findUnique.mockResolvedValueOnce(sub);
      mockPrisma.subscription.update.mockResolvedValueOnce({});
      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      await service.recordPaymentFailure('user-1', 'insufficient_funds');

      expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'OVERDUE' }) }),
      );
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'PAYMENT_FAILED' }) }),
      );
    });

    it('deve retornar sem fazer nada quando assinatura não existe', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce(null);
      await expect(service.recordPaymentFailure('user-1', 'x')).resolves.not.toThrow();
      expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
    });
  });

  // ─── clearPaymentFailure ──────────────────────────────────────
  describe('clearPaymentFailure', () => {
    it('deve reativar assinatura e limpar campos de falha', async () => {
      mockPrisma.subscription.update.mockResolvedValueOnce({});
      await service.clearPaymentFailure('user-1');
      expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'ACTIVE', payment_failed_at: null }),
        }),
      );
    });
  });

  // ─── cancelOverdueSubscriptions ───────────────────────────────
  describe('cancelOverdueSubscriptions', () => {
    it('deve fazer downgrade de assinaturas OVERDUE há mais de 4 dias', async () => {
      mockPrisma.subscription.findMany.mockResolvedValueOnce([
        { id: 'sub-1', user_id: 'user-1' },
        { id: 'sub-2', user_id: 'user-2' },
      ]);
      // downgradeToFree chama findUnique + update + auditLog
      mockPrisma.subscription.findUnique.mockResolvedValue({ id: 'sub-x' });
      mockPrisma.subscription.update.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      const count = await service.cancelOverdueSubscriptions();
      expect(count).toBe(2);
    });

    it('deve retornar 0 quando não há assinaturas vencidas', async () => {
      mockPrisma.subscription.findMany.mockResolvedValueOnce([]);
      const count = await service.cancelOverdueSubscriptions();
      expect(count).toBe(0);
    });
  });

  // ─── createCheckout ───────────────────────────────────────────
  describe('createCheckout', () => {
    it('deve chamar AsaasService e fazer upsert quando asaasId retornado', async () => {
      mockAsaasService.createPlanSubscription.mockResolvedValueOnce({
        invoiceUrl: 'https://pay.asaas.com/...', asaasId: 'sub_asaas_1', status: 'PENDING',
      });
      mockPrisma.subscription.upsert.mockResolvedValueOnce({});

      const result = await service.createCheckout('user-1', PlanType.STARTER, 'MONTHLY');
      expect(result.invoiceUrl).toBeDefined();
      expect(mockPrisma.subscription.upsert).toHaveBeenCalled();
    });

    it('deve não fazer upsert quando asaasId não retornado (FREE)', async () => {
      mockAsaasService.createPlanSubscription.mockResolvedValueOnce({ status: 'FREE_PLAN' });

      await service.createCheckout('user-1', PlanType.FREE, 'MONTHLY');
      expect(mockPrisma.subscription.upsert).not.toHaveBeenCalled();
    });
  });

  // ─── activateSubscriptionByAsaasId ───────────────────────────
  describe('activateSubscriptionByAsaasId', () => {
    it('deve ativar assinatura e registrar AuditLog', async () => {
      const sub = { id: 'sub-1', user_id: 'user-1', asaas_id: 'asaas-1', asaas_payment_id: null, period: 'MONTHLY' };
      mockPrisma.subscription.findFirst.mockResolvedValueOnce(sub);
      mockPrisma.subscription.update.mockResolvedValueOnce({});
      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      await service.activateSubscriptionByAsaasId('asaas-1', 'pay-new');
      expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE', asaas_payment_id: 'pay-new' }) }),
      );
    });

    it('deve ser idempotente — ignorar payment_id duplicado', async () => {
      const sub = { id: 'sub-1', user_id: 'user-1', asaas_payment_id: 'pay-dup', period: 'MONTHLY' };
      mockPrisma.subscription.findFirst.mockResolvedValueOnce(sub);

      await service.activateSubscriptionByAsaasId('asaas-1', 'pay-dup');
      expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
    });

    it('deve logar warning e retornar quando asaasId não encontrado', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValueOnce(null);
      await expect(service.activateSubscriptionByAsaasId('asaas-x', 'pay-1')).resolves.not.toThrow();
    });
  });

  // ─── downgradeByAsaasId ───────────────────────────────────────
  describe('downgradeByAsaasId', () => {
    it('deve fazer downgrade quando asaasId encontrado', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValueOnce({ id: 'sub-1', user_id: 'user-1' });
      mockPrisma.subscription.findUnique.mockResolvedValueOnce({ id: 'sub-1' });
      mockPrisma.subscription.update.mockResolvedValueOnce({});
      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      await service.downgradeByAsaasId('asaas-1', 'PAYMENT_REFUNDED');
      expect(mockPrisma.subscription.update).toHaveBeenCalled();
    });

    it('deve retornar sem erro quando asaasId não encontrado', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValueOnce(null);
      await expect(service.downgradeByAsaasId('asaas-x', 'reason')).resolves.not.toThrow();
    });
  });

  // ─── recordOverdueByAsaasId ───────────────────────────────────
  describe('recordOverdueByAsaasId', () => {
    it('deve registrar falha de pagamento quando asaasId encontrado', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValueOnce({ id: 'sub-1', user_id: 'user-1' });
      mockPrisma.subscription.findUnique.mockResolvedValueOnce({ id: 'sub-1' });
      mockPrisma.subscription.update.mockResolvedValueOnce({});
      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      await service.recordOverdueByAsaasId('asaas-1', 'late');
      expect(mockPrisma.subscription.update).toHaveBeenCalled();
    });
  });
});
