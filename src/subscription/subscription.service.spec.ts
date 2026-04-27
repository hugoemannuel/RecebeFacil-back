import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionService } from './subscription.service';
import { PrismaService } from '../prisma/prisma.service';
import { PlanType } from '@prisma/client';
import { PLAN_MODULES } from '../common/plan-modules';

describe('SubscriptionService', () => {
  let service: SubscriptionService;

  const mockPrismaService = {
    subscription: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<SubscriptionService>(SubscriptionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─────────────────────────────────────────────────────────────
  // getUserPlan
  // ─────────────────────────────────────────────────────────────
  describe('getUserPlan', () => {
    it('deve retornar FREE quando não há assinatura', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValueOnce(null);
      const plan = await service.getUserPlan('user-1');
      expect(plan).toBe(PlanType.FREE);
    });

    it('deve retornar FREE quando assinatura está CANCELED', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValueOnce({
        plan_type: PlanType.PRO,
        status: 'CANCELED',
      });
      const plan = await service.getUserPlan('user-1');
      expect(plan).toBe(PlanType.FREE);
    });

    it('deve retornar FREE quando assinatura está PAST_DUE', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValueOnce({
        plan_type: PlanType.STARTER,
        status: 'PAST_DUE',
      });
      const plan = await service.getUserPlan('user-1');
      expect(plan).toBe(PlanType.FREE);
    });

    it('deve retornar o plano correto quando assinatura está ACTIVE', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValueOnce({
        plan_type: PlanType.PRO,
        status: 'ACTIVE',
      });
      const plan = await service.getUserPlan('user-1');
      expect(plan).toBe(PlanType.PRO);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getSubscriptionStatus
  // ─────────────────────────────────────────────────────────────
  describe('getSubscriptionStatus', () => {
    it('deve retornar status NONE e módulos FREE quando sem assinatura', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValueOnce(null);
      const result = await service.getSubscriptionStatus('user-1');

      expect(result.plan).toBe(PlanType.FREE);
      expect(result.status).toBe('NONE');
      expect(result.allowed_modules).toEqual(PLAN_MODULES[PlanType.FREE]);
    });

    it('deve retornar módulos do plano STARTER quando ACTIVE', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValueOnce({
        plan_type: PlanType.STARTER,
        status: 'ACTIVE',
        period: 'MONTHLY',
        current_period_end: new Date('2026-12-31'),
      });

      const result = await service.getSubscriptionStatus('user-1');

      expect(result.plan).toBe(PlanType.STARTER);
      expect(result.allowed_modules).toEqual(PLAN_MODULES[PlanType.STARTER]);
      expect(result.allowed_modules).toContain('CLIENTS');
      expect(result.allowed_modules).toContain('EXCEL_IMPORT');
    });

    it('deve retornar módulos FREE mesmo com plano PRO se CANCELED', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValueOnce({
        plan_type: PlanType.PRO,
        status: 'CANCELED',
        period: 'YEARLY',
        current_period_end: new Date('2025-01-01'),
      });

      const result = await service.getSubscriptionStatus('user-1');
      expect(result.plan).toBe(PlanType.FREE);
      expect(result.allowed_modules).toEqual(PLAN_MODULES[PlanType.FREE]);
      expect(result.allowed_modules).not.toContain('CLIENTS');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // activatePlan
  // ─────────────────────────────────────────────────────────────
  describe('activatePlan', () => {
    const mockSubscription = {
      id: 'sub-1',
      user_id: 'user-1',
      plan_type: PlanType.PRO,
      status: 'ACTIVE',
    };

    it('deve criar/atualizar assinatura e registrar AuditLog', async () => {
      mockPrismaService.subscription.upsert.mockResolvedValueOnce(mockSubscription);
      mockPrismaService.auditLog.create.mockResolvedValueOnce({});

      await service.activatePlan('user-1', PlanType.PRO, 'MONTHLY', 'pay_abc123');

      expect(mockPrismaService.subscription.upsert).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'SUBSCRIPTION_ACTIVATED',
            entity: 'Subscription',
            entity_id: 'sub-1',
          }),
        }),
      );
    });

    it('deve registrar o asaas_payment_id no AuditLog (idempotência)', async () => {
      mockPrismaService.subscription.upsert.mockResolvedValueOnce(mockSubscription);
      mockPrismaService.auditLog.create.mockResolvedValueOnce({});

      await service.activatePlan('user-1', PlanType.PRO, 'YEARLY', 'pay_xyz999');

      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            details: expect.objectContaining({ asaas_payment_id: 'pay_xyz999' }),
          }),
        }),
      );
    });

    it('deve definir current_period_end +1 mês para período MONTHLY', async () => {
      mockPrismaService.subscription.upsert.mockResolvedValueOnce(mockSubscription);
      mockPrismaService.auditLog.create.mockResolvedValueOnce({});

      await service.activatePlan('user-1', PlanType.STARTER, 'MONTHLY', 'pay_m');

      const upsertCall = mockPrismaService.subscription.upsert.mock.calls[0][0];
      const start: Date = upsertCall.update.current_period_start;
      const end: Date = upsertCall.update.current_period_end;
      const diffMonths =
        (end.getFullYear() - start.getFullYear()) * 12 +
        (end.getMonth() - start.getMonth());
      expect(diffMonths).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // downgradeToFree
  // ─────────────────────────────────────────────────────────────
  describe('downgradeToFree', () => {
    it('deve não fazer nada se o usuário não tem assinatura', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValueOnce(null);

      await service.downgradeToFree('user-1', 'PAYMENT_DELETED');

      expect(mockPrismaService.subscription.update).not.toHaveBeenCalled();
      expect(mockPrismaService.auditLog.create).not.toHaveBeenCalled();
    });

    it('deve marcar assinatura como CANCELED e registrar AuditLog', async () => {
      const sub = { id: 'sub-1', user_id: 'user-1', status: 'ACTIVE' };
      mockPrismaService.subscription.findUnique.mockResolvedValueOnce(sub);
      mockPrismaService.subscription.update.mockResolvedValueOnce({ ...sub, status: 'CANCELED' });
      mockPrismaService.auditLog.create.mockResolvedValueOnce({});

      await service.downgradeToFree('user-1', 'PAYMENT_DELETED');

      expect(mockPrismaService.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'CANCELED' },
        }),
      );
      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'SUBSCRIPTION_DOWNGRADED',
            details: { reason: 'PAYMENT_DELETED' },
          }),
        }),
      );
    });
  });
});
