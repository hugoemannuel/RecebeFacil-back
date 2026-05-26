import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ClientsService', () => {
  let service: ClientsService;

  const mockPrisma = {
    client: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    charge: { groupBy: jest.fn(), findMany: jest.fn() },
    auditLog: { create: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<ClientsService>(ClientsService);
  });

  afterEach(() => jest.clearAllMocks());

  it('deve estar definido', () => expect(service).toBeDefined());

  // ─── findAll ─────────────────────────────────────────────────
  describe('findAll', () => {
    it('deve retornar lista vazia quando não há clientes', async () => {
      mockPrisma.client.findMany.mockResolvedValueOnce([]);
      const result = await service.findAll('user-1');
      expect(result).toEqual([]);
    });

    it('deve retornar clientes com estatísticas de cobranças', async () => {
      mockPrisma.client.findMany.mockResolvedValueOnce([
        { id: 'cl1', user_id: 'u1', notes: null, created_at: new Date(), user: { name: 'João Silva', phone: '11999', email: null } },
      ]);
      mockPrisma.charge.groupBy
        .mockResolvedValueOnce([{ debtor_id: 'u1', _count: { id: 3 } }])
        .mockResolvedValueOnce([{ debtor_id: 'u1', _sum: { amount: 5000 } }]);

      const result = await service.findAll('user-1');
      expect(result).toHaveLength(1);
      expect(result[0].totalCharges).toBe(3);
      expect(result[0].totalPending).toBe(5000);
      expect(result[0].initials).toBe('JS');
    });

    it('deve calcular iniciais corretamente para nome simples', async () => {
      mockPrisma.client.findMany.mockResolvedValueOnce([
        { id: 'cl1', user_id: 'u1', notes: null, created_at: new Date(), user: { name: 'João', phone: '11999', email: null } },
      ]);
      mockPrisma.charge.groupBy.mockResolvedValue([]);

      const result = await service.findAll('user-1');
      expect(result[0].initials).toBe('JO');
    });
  });

  // ─── findOne ─────────────────────────────────────────────────
  describe('findOne', () => {
    it('deve retornar cliente com cobranças', async () => {
      mockPrisma.client.findUnique.mockResolvedValueOnce({
        id: 'cl1', creditor_id: 'user-1', user_id: 'u1', notes: null,
        created_at: new Date(), user: { name: 'Maria Lima', phone: '11999', email: null },
      });
      mockPrisma.charge.findMany.mockResolvedValueOnce([
        { id: 'c1', amount: 10000, due_date: new Date(), status: 'PENDING', description: 'X' },
      ]);

      const result = await service.findOne('user-1', 'cl1');
      expect(result.charges).toHaveLength(1);
      expect(result.initials).toBe('ML');
    });

    it('deve lançar NotFoundException para cliente inexistente', async () => {
      mockPrisma.client.findUnique.mockResolvedValueOnce(null);
      await expect(service.findOne('user-1', 'x')).rejects.toThrow(NotFoundException);
    });

    it('deve lançar ForbiddenException para IDOR', async () => {
      mockPrisma.client.findUnique.mockResolvedValueOnce({ id: 'cl1', creditor_id: 'outro' });
      await expect(service.findOne('user-1', 'cl1')).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── create ──────────────────────────────────────────────────
  describe('create', () => {
    const dto: any = { phone: '11999', name: 'Pedro', email: null, notes: 'obs' };

    it('deve criar cliente com shadow user novo', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      mockPrisma.user.create.mockResolvedValueOnce({ id: 'u2' });
      mockPrisma.client.upsert.mockResolvedValueOnce({ id: 'cl2', user: {} });
      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      const result = await service.create('user-1', dto);
      expect(result.success).toBe(true);
      expect(mockPrisma.user.create).toHaveBeenCalled();
    });

    it('deve reutilizar usuário existente pelo telefone', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'u-existing' });
      mockPrisma.client.upsert.mockResolvedValueOnce({ id: 'cl3', user: {} });
      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      await service.create('user-1', dto);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });
  });

  // ─── update ──────────────────────────────────────────────────
  describe('update', () => {
    it('deve atualizar notas e dados do usuário', async () => {
      mockPrisma.client.findUnique.mockResolvedValueOnce({
        id: 'cl1', creditor_id: 'user-1', user_id: 'u1', user: { name: 'X' },
      });
      mockPrisma.client.update.mockResolvedValueOnce({});
      mockPrisma.user.update.mockResolvedValueOnce({});

      const result = await service.update('user-1', 'cl1', { name: 'Novo Nome', email: 'a@b.com' });
      expect(result.success).toBe(true);
      expect(mockPrisma.user.update).toHaveBeenCalled();
    });

    it('deve lançar NotFoundException para cliente inexistente', async () => {
      mockPrisma.client.findUnique.mockResolvedValueOnce(null);
      await expect(service.update('user-1', 'x', {})).rejects.toThrow(NotFoundException);
    });

    it('deve lançar NotFoundException para IDOR', async () => {
      mockPrisma.client.findUnique.mockResolvedValueOnce({ id: 'cl1', creditor_id: 'outro' });
      await expect(service.update('user-1', 'cl1', {})).rejects.toThrow(NotFoundException);
    });
  });

  // ─── remove ──────────────────────────────────────────────────
  describe('remove', () => {
    it('deve remover cliente e registrar AuditLog', async () => {
      mockPrisma.client.findUnique.mockResolvedValueOnce({ id: 'cl1', creditor_id: 'user-1' });
      mockPrisma.client.delete.mockResolvedValueOnce({});
      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      const result = await service.remove('user-1', 'cl1');
      expect(result.success).toBe(true);
    });

    it('deve lançar NotFoundException para IDOR', async () => {
      mockPrisma.client.findUnique.mockResolvedValueOnce(null);
      await expect(service.remove('user-1', 'x')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── upsertFromCharge ────────────────────────────────────────
  describe('upsertFromCharge', () => {
    it('deve fazer upsert do cliente a partir de cobrança', async () => {
      mockPrisma.client.upsert.mockResolvedValueOnce({});
      await service.upsertFromCharge('user-1', 'debtor-1');
      expect(mockPrisma.client.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ creditor_id: 'user-1', user_id: 'debtor-1' }),
        }),
      );
    });
  });
});
