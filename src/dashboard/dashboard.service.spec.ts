import { Test, TestingModule } from '@nestjs/testing';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../prisma/prisma.service';

describe('DashboardService', () => {
  let service: DashboardService;

  const mockPrisma = {
    charge: {
      aggregate: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
      findMany: jest.fn(),
    },
    recurringCharge: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<DashboardService>(DashboardService);
  });

  afterEach(() => jest.clearAllMocks());

  it('deve estar definido', () => expect(service).toBeDefined());

  // ─── getMetrics ───────────────────────────────────────────────
  describe('getMetrics', () => {
    const setupMocks = () => {
      // getSummaryMetrics — 7 queries paralelas
      mockPrisma.charge.aggregate
        .mockResolvedValue({ _sum: { amount: 5000 } }); // pending + overdue + chart queries
      mockPrisma.charge.count.mockResolvedValue(5);
      mockPrisma.recurringCharge.findMany.mockResolvedValue([]);

      // getActionNecessary
      // (usa charge.count — já mockado acima)

      // getTopClients
      mockPrisma.charge.groupBy.mockResolvedValue([
        { debtor_id: 'u1', _sum: { amount: 10000 } },
      ]);
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'u1', name: 'João Silva' }]);

      // getRecentActivity
      mockPrisma.charge.findMany.mockResolvedValue([
        { id: 'c1', debtor: { name: 'João', email: null, phone: '11999' }, amount: 1000, due_date: new Date(), status: 'PENDING' },
      ]);
    };

    it('deve retornar métricas com summary, topClients, chart e recentActivity', async () => {
      setupMocks();
      const result = await service.getMetrics('user-1');
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('topClients');
      expect(result).toHaveProperty('chart');
      expect(result).toHaveProperty('recentActivity');
      expect(result).toHaveProperty('actionNecessary');
    });

    it('deve retornar lista vazia para topClients quando não há cobranças', async () => {
      mockPrisma.charge.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      mockPrisma.charge.count.mockResolvedValue(0);
      mockPrisma.recurringCharge.findMany.mockResolvedValue([]);
      mockPrisma.charge.groupBy.mockResolvedValue([]);
      mockPrisma.charge.findMany.mockResolvedValue([]);

      const result = await service.getMetrics('user-1');
      expect(result.topClients).toEqual([]);
    });

    it('deve aceitar period=month e retornar dados semanais', async () => {
      mockPrisma.charge.aggregate.mockResolvedValue({ _sum: { amount: 0 }, _count: 0 });
      mockPrisma.charge.count.mockResolvedValue(0);
      mockPrisma.recurringCharge.findMany.mockResolvedValue([]);
      mockPrisma.charge.groupBy.mockResolvedValue([]);
      mockPrisma.charge.findMany.mockResolvedValue([]);

      const result = await service.getMetrics('user-1', 'month');
      expect(result.chart).toHaveLength(4); // 4 semanas
    });

    it('deve filtrar recentActivity por status válido', async () => {
      mockPrisma.charge.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      mockPrisma.charge.count.mockResolvedValue(0);
      mockPrisma.recurringCharge.findMany.mockResolvedValue([]);
      mockPrisma.charge.groupBy.mockResolvedValue([]);
      mockPrisma.charge.findMany.mockResolvedValue([]);

      await service.getMetrics('user-1', '7days', 'PAID');
      const findManyCall = mockPrisma.charge.findMany.mock.calls[0][0];
      expect(findManyCall.where.status).toBe('PAID');
    });

    it('deve ignorar statusFilter inválido', async () => {
      mockPrisma.charge.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      mockPrisma.charge.count.mockResolvedValue(0);
      mockPrisma.recurringCharge.findMany.mockResolvedValue([]);
      mockPrisma.charge.groupBy.mockResolvedValue([]);
      mockPrisma.charge.findMany.mockResolvedValue([]);

      await service.getMetrics('user-1', '7days', 'INVALIDO');
      const findManyCall = mockPrisma.charge.findMany.mock.calls[0][0];
      expect(findManyCall.where.status).toBeUndefined();
    });

    it('deve calcular conversionRate 0 quando não há cobranças', async () => {
      mockPrisma.charge.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      mockPrisma.charge.count.mockResolvedValue(0);
      mockPrisma.recurringCharge.findMany.mockResolvedValue([]);
      mockPrisma.charge.groupBy.mockResolvedValue([]);
      mockPrisma.charge.findMany.mockResolvedValue([]);

      const result = await service.getMetrics('user-1');
      expect(result.summary.conversionRate).toBe('0.0');
    });

    it('deve calcular futureRecurring com max_installments', async () => {
      mockPrisma.charge.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      mockPrisma.charge.count.mockResolvedValue(0);
      mockPrisma.recurringCharge.findMany.mockResolvedValue([
        { amount: 10000, max_installments: 5, _count: { charges: 2 } },
      ]);
      mockPrisma.charge.groupBy.mockResolvedValue([]);
      mockPrisma.charge.findMany.mockResolvedValue([]);

      const result = await service.getMetrics('user-1');
      // 5 - 2 = 3 restantes × 10000 = 30000
      expect(result.summary.totalFutureRecurring).toBe(30000);
    });
  });
});
