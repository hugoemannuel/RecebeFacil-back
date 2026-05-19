import { Test, TestingModule } from '@nestjs/testing';
import { ReportsService } from './reports.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ReportsService', () => {
  let service: ReportsService;

  const mockPrisma = {
    charge: { findMany: jest.fn() },
    client: { findMany: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<ReportsService>(ReportsService);
  });

  afterEach(() => jest.clearAllMocks());

  it('deve estar definido', () => expect(service).toBeDefined());

  // ─── getSummary ───────────────────────────────────────────────
  describe('getSummary', () => {
    it('deve calcular totais por status corretamente', async () => {
      mockPrisma.charge.findMany.mockResolvedValueOnce([
        { amount: 10000, status: 'PAID' },
        { amount: 5000, status: 'OVERDUE' },
        { amount: 3000, status: 'PENDING' },
        { amount: 2000, status: 'CANCELED' }, // ignorado
      ]);

      const result = await service.getSummary('user-1');
      expect(result.totalPaid).toBeCloseTo(100); // 10000 centavos = R$100
      expect(result.totalOverdue).toBeCloseTo(50);
      expect(result.totalPending).toBeCloseTo(30);
      expect(result.countPaid).toBe(1);
      expect(result.countOverdue).toBe(1);
      expect(result.countPending).toBe(1);
    });

    it('deve retornar zeros quando não há cobranças', async () => {
      mockPrisma.charge.findMany.mockResolvedValueOnce([]);
      const result = await service.getSummary('user-1');
      expect(result.totalPaid).toBe(0);
      expect(result.totalOverdue).toBe(0);
      expect(result.totalPending).toBe(0);
    });
  });

  // ─── getCustomerRanking ───────────────────────────────────────
  describe('getCustomerRanking', () => {
    it('deve retornar ranking de devedores com cobranças OVERDUE', async () => {
      mockPrisma.client.findMany.mockResolvedValueOnce([
        {
          user: {
            id: 'u1', name: 'Mau Pagador',
            charges_as_debtor: [{ amount: 20000 }, { amount: 10000 }],
          },
        },
        {
          user: {
            id: 'u2', name: 'Bom Pagador',
            charges_as_debtor: [],
          },
        },
      ]);

      const result = await service.getCustomerRanking('user-1');
      expect(result).toHaveLength(1); // só quem tem overdue
      expect(result[0].name).toBe('Mau Pagador');
      expect(result[0].overdueCount).toBe(2);
      expect(result[0].totalOverdueAmount).toBeCloseTo(300); // (20000+10000)/100
    });

    it('deve retornar lista vazia sem clientes inadimplentes', async () => {
      mockPrisma.client.findMany.mockResolvedValueOnce([
        { user: { id: 'u1', name: 'X', charges_as_debtor: [] } },
      ]);
      const result = await service.getCustomerRanking('user-1');
      expect(result).toEqual([]);
    });
  });

  // ─── getRecoveryPerformance ───────────────────────────────────
  describe('getRecoveryPerformance', () => {
    it('deve calcular taxa de recuperação corretamente', async () => {
      const firstReminder = new Date('2026-05-01');
      const paymentDate = new Date('2026-05-03');
      mockPrisma.charge.findMany.mockResolvedValueOnce([
        {
          status: 'PAID', amount: 10000, payment_date: paymentDate,
          messages: [{ sent_at: firstReminder }],
        },
        {
          status: 'PENDING', amount: 5000, payment_date: null,
          messages: [{ sent_at: firstReminder }],
        },
      ]);

      const result = await service.getRecoveryPerformance('user-1');
      expect(result.recoveryRate).toBe(50.0); // 1 de 2
      expect(result.recoveredAmount).toBeCloseTo(100);
      expect(result.avoidedChurn).toBe(1);
    });

    it('deve retornar zeros quando não há cobranças com mensagens', async () => {
      mockPrisma.charge.findMany.mockResolvedValueOnce([]);
      const result = await service.getRecoveryPerformance('user-1');
      expect(result.recoveryRate).toBe(0);
      expect(result.recoveredAmount).toBe(0);
    });

    it('deve ignorar cobranças pagas ANTES do primeiro lembrete', async () => {
      const firstReminder = new Date('2026-05-05');
      const paymentDate = new Date('2026-05-01'); // pagou antes do lembrete
      mockPrisma.charge.findMany.mockResolvedValueOnce([
        {
          status: 'PAID', amount: 10000, payment_date: paymentDate,
          messages: [{ sent_at: firstReminder }],
        },
      ]);
      const result = await service.getRecoveryPerformance('user-1');
      expect(result.avoidedChurn).toBe(0);
    });
  });

  // ─── getForecast ──────────────────────────────────────────────
  describe('getForecast', () => {
    it('deve retornar array de projeção de 30 dias', async () => {
      mockPrisma.charge.findMany.mockResolvedValueOnce([]);
      const result = await service.getForecast('user-1');
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it('deve incluir cobranças PENDING/OVERDUE no forecast', async () => {
      const today = new Date();
      mockPrisma.charge.findMany.mockResolvedValueOnce([
        { amount: 50000, due_date: today },
      ]);
      const result = await service.getForecast('user-1');
      const totalValor = result.reduce((sum: number, d: any) => sum + d.valor, 0);
      expect(totalValor).toBeGreaterThan(0);
    });
  });
});
