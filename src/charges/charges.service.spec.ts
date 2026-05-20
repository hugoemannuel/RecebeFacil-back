import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import { ChargesService } from './charges.service';
import { PrismaService } from '../prisma/prisma.service';
import { ClientsService } from '../clients/clients.service';
import { PgBossService } from '../queue/pg-boss.service';
import { AsaasService } from '../integrations/asaas.service';

describe('ChargesService', () => {
  let service: ChargesService;

  const mockPrisma = {
    subscription: { findUnique: jest.fn() },
    charge: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    recurringCharge: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    user: { findUnique: jest.fn(), create: jest.fn() },
    creditorProfile: { findUnique: jest.fn(), upsert: jest.fn() },
    messageTemplate: { count: jest.fn(), create: jest.fn() },
    messageHistory: { create: jest.fn(), findFirst: jest.fn() },
    auditLog: { create: jest.fn() },
    integrationConfig: { findUnique: jest.fn() },
  };

  const mockClientsService = { upsertFromCharge: jest.fn() };
  const mockPgBoss = { send: jest.fn().mockResolvedValue('job-id-1') };
  const mockAsaas = { createIntermediatedPayment: jest.fn() };

  const activeSub = { plan_type: 'PRO', status: 'ACTIVE' };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChargesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ClientsService, useValue: mockClientsService },
        { provide: PgBossService, useValue: mockPgBoss },
        { provide: AsaasService, useValue: mockAsaas },
      ],
    }).compile();
    service = module.get<ChargesService>(ChargesService);
  });

  afterEach(() => jest.clearAllMocks());

  it('deve estar definido', () => expect(service).toBeDefined());

  // ─── findAll ───────────────────────────────────────────────────
  describe('findAll', () => {
    it('deve retornar cobranças mapeadas do usuário', async () => {
      mockPrisma.charge.findMany.mockResolvedValueOnce([
        {
          id: 'c1', debtor: { name: 'João', phone: '11999' }, amount: 10000,
          due_date: new Date('2026-06-01'), status: 'PENDING',
          recurring_charge: null, recurring_charge_id: null,
        },
      ]);
      const result = await service.findAll('user-1');
      expect(result).toHaveLength(1);
      expect(result[0].debtorName).toBe('João');
      expect(result[0].recurrence).toBe('ONCE');
    });
  });

  // ─── findAllRecurring ──────────────────────────────────────────
  describe('findAllRecurring', () => {
    it('deve retornar regras recorrentes mapeadas', async () => {
      mockPrisma.recurringCharge.findMany.mockResolvedValueOnce([
        {
          id: 'r1', amount: 5000, description: 'Mensalidade', frequency: 'MONTHLY',
          next_generation_date: new Date(), active: true, custom_message: null,
          debtors: [{ debtor: { name: 'Maria' } }],
          _count: { charges: 2 },
        },
      ]);
      const result = await service.findAllRecurring('user-1');
      expect(result[0].debtorName).toBe('Maria');
      expect(result[0].totalGenerated).toBe(2);
    });
  });

  // ─── findOne ──────────────────────────────────────────────────
  describe('findOne', () => {
    it('deve retornar cobrança do próprio usuário', async () => {
      mockPrisma.charge.findUnique.mockResolvedValueOnce({
        id: 'c1', creditor_id: 'user-1', debtor: {}, messages: [],
      });
      const result = await service.findOne('user-1', 'c1');
      expect(result.id).toBe('c1');
    });

    it('deve lançar ForbiddenException para cobrança inexistente', async () => {
      mockPrisma.charge.findUnique.mockResolvedValueOnce(null);
      await expect(service.findOne('user-1', 'x')).rejects.toThrow(ForbiddenException);
    });

    it('deve lançar ForbiddenException para cobrança de outro usuário (IDOR)', async () => {
      mockPrisma.charge.findUnique.mockResolvedValueOnce({ id: 'c1', creditor_id: 'outro' });
      await expect(service.findOne('user-1', 'c1')).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── createCharge ─────────────────────────────────────────────
  describe('createCharge', () => {
    const dto: any = {
      debtor_phone: '11999', debtor_name: 'Ana', amount: 10000,
      description: 'Serviço', due_date: '2026-06-01', recurrence: 'ONCE',
    };

    it('deve criar cobrança ONCE com sucesso (plano PRO)', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce(activeSub);
      mockPrisma.charge.count.mockResolvedValueOnce(0);
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'debtor-1' });
      mockPrisma.charge.create.mockResolvedValueOnce({ id: 'charge-new' });
      mockPrisma.messageHistory.create.mockResolvedValueOnce({});
      mockPrisma.auditLog.create.mockResolvedValueOnce({});
      mockClientsService.upsertFromCharge.mockResolvedValueOnce({});

      const result = await service.createCharge('user-1', dto);
      expect(result.success).toBe(true);
      expect(result.chargeId).toBe('charge-new');
    });

    it('deve criar shadow user quando devedor não existe', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce(activeSub);
      mockPrisma.charge.count.mockResolvedValueOnce(0);
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      mockPrisma.user.create.mockResolvedValueOnce({ id: 'shadow-1' });
      mockPrisma.charge.create.mockResolvedValueOnce({ id: 'c2' });
      mockPrisma.messageHistory.create.mockResolvedValueOnce({});
      mockPrisma.auditLog.create.mockResolvedValueOnce({});
      mockClientsService.upsertFromCharge.mockResolvedValueOnce({});

      await service.createCharge('user-1', dto);
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ is_registered: false }) }),
      );
    });

    it('deve criar RecurringCharge quando recurrence !== ONCE', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce(activeSub);
      mockPrisma.charge.count.mockResolvedValueOnce(0);
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'debtor-1' });
      mockPrisma.recurringCharge.create.mockResolvedValueOnce({ id: 'rec-1' });
      mockPrisma.charge.create.mockResolvedValueOnce({ id: 'c3' });
      mockPrisma.messageHistory.create.mockResolvedValueOnce({});
      mockPrisma.auditLog.create.mockResolvedValueOnce({});
      mockClientsService.upsertFromCharge.mockResolvedValueOnce({});

      await service.createCharge('user-1', { ...dto, recurrence: 'MONTHLY' });
      expect(mockPrisma.recurringCharge.create).toHaveBeenCalled();
    });

    it('deve lançar ForbiddenException quando assinatura inativa', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce(null);
      await expect(service.createCharge('user-1', dto)).rejects.toThrow(ForbiddenException);
    });

    it('deve lançar ForbiddenException LIMIT_REACHED quando atingiu limite', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce({ plan_type: 'FREE', status: 'ACTIVE' });
      mockPrisma.charge.count.mockResolvedValueOnce(10);
      await expect(service.createCharge('user-1', dto)).rejects.toThrow('LIMIT_REACHED');
    });

    it('deve lançar ForbiddenException RECURRENCE_NOT_ALLOWED para FREE com MONTHLY', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce({ plan_type: 'FREE', status: 'ACTIVE' });
      await expect(service.createCharge('user-1', { ...dto, recurrence: 'MONTHLY' })).rejects.toThrow('RECURRENCE_NOT_ALLOWED');
    });

    it('deve salvar template quando save_as_template=true e plano permite', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce(activeSub);
      mockPrisma.charge.count.mockResolvedValueOnce(0);
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'debtor-1' });
      mockPrisma.charge.create.mockResolvedValueOnce({ id: 'c4' });
      mockPrisma.messageHistory.create.mockResolvedValueOnce({});
      mockPrisma.auditLog.create.mockResolvedValue({});
      mockClientsService.upsertFromCharge.mockResolvedValueOnce({});
      mockPrisma.creditorProfile.findUnique.mockResolvedValueOnce({ id: 'prof-1' });
      mockPrisma.messageTemplate.count.mockResolvedValueOnce(0);
      mockPrisma.messageTemplate.create.mockResolvedValueOnce({});

      await service.createCharge('user-1', {
        ...dto, save_as_template: true, template_name: 'Modelo', custom_message: 'Olá!',
      });
      expect(mockPrisma.messageTemplate.create).toHaveBeenCalled();
    });

    it('deve atualizar CreditorProfile quando send_pix_button=true', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce(activeSub);
      mockPrisma.charge.count.mockResolvedValueOnce(0);
      mockPrisma.creditorProfile.upsert.mockResolvedValueOnce({});
      mockPrisma.auditLog.create.mockResolvedValue({});
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'debtor-1' });
      mockPrisma.charge.create.mockResolvedValueOnce({ id: 'c5' });
      mockPrisma.messageHistory.create.mockResolvedValueOnce({});
      mockClientsService.upsertFromCharge.mockResolvedValueOnce({});

      await service.createCharge('user-1', {
        ...dto, send_pix_button: true, pix_key: '123456', pix_key_type: 'CPF',
      });
      expect(mockPrisma.creditorProfile.upsert).toHaveBeenCalled();
    });

    // ─── split / intermediação ─────────────────────────────────────
    it('deve lançar SPLIT_PLAN_REQUIRED para plano FREE com is_intermediated', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce({ plan_type: 'FREE', status: 'ACTIVE' });
      mockPrisma.charge.count.mockResolvedValueOnce(0);
      await expect(service.createCharge('user-1', { ...dto, is_intermediated: true }))
        .rejects.toThrow('SPLIT_PLAN_REQUIRED');
    });

    it('deve lançar SPLIT_PLAN_REQUIRED para plano STARTER com is_intermediated', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce({ plan_type: 'STARTER', status: 'ACTIVE' });
      mockPrisma.charge.count.mockResolvedValueOnce(0);
      await expect(service.createCharge('user-1', { ...dto, is_intermediated: true }))
        .rejects.toThrow('SPLIT_PLAN_REQUIRED');
    });

    it('deve lançar SPLIT_TERMS_NOT_ACCEPTED quando termos não foram aceitos', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce(activeSub);
      mockPrisma.charge.count.mockResolvedValueOnce(0);
      mockPrisma.integrationConfig.findUnique.mockResolvedValueOnce({ split_terms_accepted_at: null });
      await expect(service.createCharge('user-1', { ...dto, is_intermediated: true }))
        .rejects.toThrow('SPLIT_TERMS_NOT_ACCEPTED');
    });

    it('deve criar cobrança intermediada e retornar asaas_invoice_url (plano PRO, taxa 2%)', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce(activeSub);
      mockPrisma.charge.count.mockResolvedValueOnce(0);
      mockPrisma.integrationConfig.findUnique.mockResolvedValueOnce({ split_terms_accepted_at: new Date() });
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'debtor-1', name: 'Ana', phone: '5511999' });
      mockPrisma.charge.create.mockResolvedValueOnce({ id: 'charge-split' });
      mockAsaas.createIntermediatedPayment.mockResolvedValueOnce({
        asaasPaymentId: 'pay_001',
        invoiceUrl: 'https://asaas.com/c/pay_001',
      });
      mockPrisma.charge.update.mockResolvedValueOnce({});
      mockPrisma.messageHistory.create.mockResolvedValueOnce({});
      mockPrisma.auditLog.create.mockResolvedValue({});
      mockClientsService.upsertFromCharge.mockResolvedValueOnce({});

      const result = await service.createCharge('user-1', { ...dto, is_intermediated: true });

      expect(mockAsaas.createIntermediatedPayment).toHaveBeenCalledWith(
        expect.objectContaining({ chargeId: 'charge-split', amountCentavos: 10000 }),
      );
      expect(mockPrisma.charge.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ is_intermediated: true, platform_fee_pct: 2.0 }),
        }),
      );
      expect(result.asaas_invoice_url).toBe('https://asaas.com/c/pay_001');
    });

    it('deve usar taxa 1% para plano UNLIMITED', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce({ plan_type: 'UNLIMITED', status: 'ACTIVE' });
      mockPrisma.charge.count.mockResolvedValueOnce(0);
      mockPrisma.integrationConfig.findUnique.mockResolvedValueOnce({ split_terms_accepted_at: new Date() });
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'debtor-1', name: 'Ana', phone: '5511999' });
      mockPrisma.charge.create.mockResolvedValueOnce({ id: 'charge-unlimited' });
      mockAsaas.createIntermediatedPayment.mockResolvedValueOnce({ asaasPaymentId: 'p2', invoiceUrl: 'https://url' });
      mockPrisma.charge.update.mockResolvedValueOnce({});
      mockPrisma.messageHistory.create.mockResolvedValueOnce({});
      mockPrisma.auditLog.create.mockResolvedValue({});
      mockClientsService.upsertFromCharge.mockResolvedValueOnce({});

      await service.createCharge('user-1', { ...dto, is_intermediated: true });

      expect(mockPrisma.charge.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ platform_fee_pct: 1.0 }),
        }),
      );
    });

    it('deve deletar cobrança e re-lançar se Asaas falhar', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce(activeSub);
      mockPrisma.charge.count.mockResolvedValueOnce(0);
      mockPrisma.integrationConfig.findUnique.mockResolvedValueOnce({ split_terms_accepted_at: new Date() });
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'debtor-1', name: 'Ana', phone: '5511999' });
      mockPrisma.charge.create.mockResolvedValueOnce({ id: 'charge-fail' });
      mockAsaas.createIntermediatedPayment.mockRejectedValueOnce(new Error('Asaas indisponível'));
      mockPrisma.charge.delete.mockResolvedValueOnce({});

      await expect(service.createCharge('user-1', { ...dto, is_intermediated: true }))
        .rejects.toThrow('Asaas indisponível');
      expect(mockPrisma.charge.delete).toHaveBeenCalledWith({ where: { id: 'charge-fail' } });
    });
  });

  // ─── updateChargeStatus ───────────────────────────────────────
  describe('updateChargeStatus', () => {
    it('deve atualizar status e registrar AuditLog', async () => {
      mockPrisma.charge.findUnique.mockResolvedValueOnce({ id: 'c1', creditor_id: 'user-1', status: 'PENDING' });
      mockPrisma.charge.update.mockResolvedValueOnce({});
      mockPrisma.auditLog.create.mockResolvedValueOnce({});
      const result = await service.updateChargeStatus('user-1', 'c1', 'PAID');
      expect(result.success).toBe(true);
    });

    it('deve lançar NotFoundException para cobrança inexistente', async () => {
      mockPrisma.charge.findUnique.mockResolvedValueOnce(null);
      await expect(service.updateChargeStatus('user-1', 'x', 'PAID')).rejects.toThrow(NotFoundException);
    });

    it('deve lançar ForbiddenException para IDOR', async () => {
      mockPrisma.charge.findUnique.mockResolvedValueOnce({ id: 'c1', creditor_id: 'outro' });
      await expect(service.updateChargeStatus('user-1', 'c1', 'PAID')).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── hardDeleteCharge ─────────────────────────────────────────
  describe('hardDeleteCharge', () => {
    it('deve deletar e registrar AuditLog', async () => {
      mockPrisma.charge.findUnique.mockResolvedValueOnce({ id: 'c1', creditor_id: 'user-1' });
      mockPrisma.charge.delete.mockResolvedValueOnce({});
      mockPrisma.auditLog.create.mockResolvedValueOnce({});
      const result = await service.hardDeleteCharge('user-1', 'c1');
      expect(result.success).toBe(true);
    });

    it('deve lançar NotFoundException', async () => {
      mockPrisma.charge.findUnique.mockResolvedValueOnce(null);
      await expect(service.hardDeleteCharge('user-1', 'x')).rejects.toThrow(NotFoundException);
    });

    it('deve lançar ForbiddenException para IDOR', async () => {
      mockPrisma.charge.findUnique.mockResolvedValueOnce({ id: 'c1', creditor_id: 'outro' });
      await expect(service.hardDeleteCharge('user-1', 'c1')).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── cancelCharge ─────────────────────────────────────────────
  describe('cancelCharge', () => {
    it('deve cancelar cobrança e registrar AuditLog', async () => {
      mockPrisma.charge.findUnique.mockResolvedValueOnce({ id: 'c1', creditor_id: 'user-1' });
      mockPrisma.charge.update.mockResolvedValueOnce({});
      mockPrisma.auditLog.create.mockResolvedValueOnce({});
      const result = await service.cancelCharge('user-1', 'c1');
      expect(result.success).toBe(true);
    });

    it('deve lançar ForbiddenException para cobrança inexistente', async () => {
      mockPrisma.charge.findUnique.mockResolvedValueOnce(null);
      await expect(service.cancelCharge('user-1', 'x')).rejects.toThrow(ForbiddenException);
    });

    it('deve lançar ForbiddenException para IDOR', async () => {
      mockPrisma.charge.findUnique.mockResolvedValueOnce({ id: 'c1', creditor_id: 'outro' });
      await expect(service.cancelCharge('user-1', 'c1')).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── bulkCancel ───────────────────────────────────────────────
  describe('bulkCancel', () => {
    it('deve cancelar cobranças em massa para plano PRO', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce({ plan_type: 'PRO', status: 'ACTIVE' });
      mockPrisma.charge.findMany.mockResolvedValueOnce([{ id: 'c1' }, { id: 'c2' }]);
      mockPrisma.charge.updateMany.mockResolvedValueOnce({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.bulkCancel('user-1', ['c1', 'c2']);
      expect(result.count).toBe(2);
    });

    it('deve retornar count=0 quando nenhuma cobrança válida encontrada', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce({ plan_type: 'PRO', status: 'ACTIVE' });
      mockPrisma.charge.findMany.mockResolvedValueOnce([]);
      const result = await service.bulkCancel('user-1', ['x']);
      expect(result.count).toBe(0);
    });

    it('deve lançar ForbiddenException para plano FREE', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce({ plan_type: 'FREE' });
      await expect(service.bulkCancel('user-1', ['c1'])).rejects.toThrow(ForbiddenException);
    });

    it('deve lançar ForbiddenException para plano STARTER', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce({ plan_type: 'STARTER' });
      await expect(service.bulkCancel('user-1', ['c1'])).rejects.toThrow(ForbiddenException);
    });

    it('deve lançar ForbiddenException sem assinatura', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce(null);
      await expect(service.bulkCancel('user-1', ['c1'])).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── bulkRemind ───────────────────────────────────────────────
  describe('bulkRemind', () => {
    it('deve criar MessageHistory para cobranças válidas', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce({ plan_type: 'PRO', status: 'ACTIVE' });
      mockPrisma.charge.findMany.mockResolvedValueOnce([{ id: 'c1' }]);
      mockPrisma.messageHistory.create.mockResolvedValueOnce({});
      const result = await service.bulkRemind('user-1', ['c1']);
      expect(result.count).toBe(1);
    });

    it('deve lançar ForbiddenException para plano STARTER', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce({ plan_type: 'STARTER' });
      await expect(service.bulkRemind('user-1', ['c1'])).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── findOneRecurring ─────────────────────────────────────────
  describe('findOneRecurring', () => {
    it('deve retornar regra recorrente do próprio usuário', async () => {
      mockPrisma.recurringCharge.findUnique.mockResolvedValueOnce({
        id: 'r1', creditor_id: 'user-1', amount: 5000, description: 'X',
        frequency: 'MONTHLY', next_generation_date: new Date(),
        custom_message: null, max_installments: null,
        debtors: [{ debtor: { name: 'João' } }],
      });
      const result = await service.findOneRecurring('user-1', 'r1');
      expect(result.debtorName).toBe('João');
    });

    it('deve lançar ForbiddenException para IDOR', async () => {
      mockPrisma.recurringCharge.findUnique.mockResolvedValueOnce({ id: 'r1', creditor_id: 'outro' });
      await expect(service.findOneRecurring('user-1', 'r1')).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── cancelRecurring ──────────────────────────────────────────
  describe('cancelRecurring', () => {
    it('deve desativar regra recorrente', async () => {
      mockPrisma.recurringCharge.findUnique.mockResolvedValueOnce({ id: 'r1', creditor_id: 'user-1' });
      mockPrisma.recurringCharge.update.mockResolvedValueOnce({});
      const result = await service.cancelRecurring('user-1', 'r1');
      expect(result.success).toBe(true);
    });

    it('deve lançar ForbiddenException para IDOR', async () => {
      mockPrisma.recurringCharge.findUnique.mockResolvedValueOnce(null);
      await expect(service.cancelRecurring('user-1', 'r1')).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── updateRecurring ──────────────────────────────────────────
  describe('updateRecurring', () => {
    it('deve atualizar regra e registrar AuditLog', async () => {
      mockPrisma.recurringCharge.findUnique.mockResolvedValueOnce({ id: 'r1', creditor_id: 'user-1' });
      mockPrisma.recurringCharge.update.mockResolvedValueOnce({ id: 'r1' });
      mockPrisma.auditLog.create.mockResolvedValueOnce({});
      const result = await service.updateRecurring('user-1', 'r1', { description: 'Novo' });
      expect(result.success).toBe(true);
    });

    it('deve lançar NotFoundException', async () => {
      mockPrisma.recurringCharge.findUnique.mockResolvedValueOnce(null);
      await expect(service.updateRecurring('user-1', 'r1', {})).rejects.toThrow(NotFoundException);
    });

    it('deve lançar ForbiddenException para IDOR', async () => {
      mockPrisma.recurringCharge.findUnique.mockResolvedValueOnce({ id: 'r1', creditor_id: 'outro' });
      await expect(service.updateRecurring('user-1', 'r1', {})).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── deleteRecurring ──────────────────────────────────────────
  describe('deleteRecurring', () => {
    it('deve deletar regra e registrar AuditLog', async () => {
      mockPrisma.recurringCharge.findUnique.mockResolvedValueOnce({ id: 'r1', creditor_id: 'user-1' });
      mockPrisma.recurringCharge.delete.mockResolvedValueOnce({});
      mockPrisma.auditLog.create.mockResolvedValueOnce({});
      const result = await service.deleteRecurring('user-1', 'r1');
      expect(result.success).toBe(true);
    });

    it('deve lançar NotFoundException', async () => {
      mockPrisma.recurringCharge.findUnique.mockResolvedValueOnce(null);
      await expect(service.deleteRecurring('user-1', 'r1')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── reactivateRecurring ──────────────────────────────────────
  describe('reactivateRecurring', () => {
    it('deve reativar regra e registrar AuditLog', async () => {
      mockPrisma.recurringCharge.findUnique.mockResolvedValueOnce({ id: 'r1', creditor_id: 'user-1' });
      mockPrisma.recurringCharge.update.mockResolvedValueOnce({});
      mockPrisma.auditLog.create.mockResolvedValueOnce({});
      const result = await service.reactivateRecurring('user-1', 'r1');
      expect(result.success).toBe(true);
    });

    it('deve lançar NotFoundException', async () => {
      mockPrisma.recurringCharge.findUnique.mockResolvedValueOnce(null);
      await expect(service.reactivateRecurring('user-1', 'r1')).rejects.toThrow(NotFoundException);
    });

    it('deve lançar ForbiddenException para IDOR', async () => {
      mockPrisma.recurringCharge.findUnique.mockResolvedValueOnce({ id: 'r1', creditor_id: 'outro' });
      await expect(service.reactivateRecurring('user-1', 'r1')).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── automateCharge ───────────────────────────────────────────
  describe('automateCharge', () => {
    const dto: any = { frequency: 'MONTHLY', next_generation_date: '2026-07-01' };

    it('deve criar RegurringCharge e vincular à cobrança', async () => {
      mockPrisma.charge.findUnique.mockResolvedValueOnce({
        id: 'c1', creditor_id: 'user-1', recurring_charge_id: null,
        debtor: { id: 'debtor-1' }, debtor_id: 'debtor-1',
        amount: 10000, description: 'X', custom_message: null,
      });
      mockPrisma.recurringCharge.create.mockResolvedValueOnce({ id: 'rec-1' });
      mockPrisma.charge.update.mockResolvedValueOnce({});
      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      const result = await service.automateCharge('user-1', 'c1', dto);
      expect(result.recurringChargeId).toBe('rec-1');
    });

    it('deve lançar ForbiddenException se já tem automação', async () => {
      mockPrisma.charge.findUnique.mockResolvedValueOnce({
        id: 'c1', creditor_id: 'user-1', recurring_charge_id: 'existing',
      });
      await expect(service.automateCharge('user-1', 'c1', dto)).rejects.toThrow(ForbiddenException);
    });

    it('deve lançar ForbiddenException para IDOR', async () => {
      mockPrisma.charge.findUnique.mockResolvedValueOnce({ id: 'c1', creditor_id: 'outro' });
      await expect(service.automateCharge('user-1', 'c1', dto)).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── notifyNow ────────────────────────────────────────────────
  describe('notifyNow', () => {
    const charge = { id: 'c1', creditor_id: 'user-1' };

    it('deve enfileirar job e retornar { queued: true }', async () => {
      mockPrisma.charge.findUnique.mockResolvedValueOnce(charge);
      mockPrisma.messageHistory.findFirst.mockResolvedValueOnce(null);

      const result = await service.notifyNow('user-1', 'c1', 'BEFORE_DUE');

      expect(mockPgBoss.send).toHaveBeenCalledWith(
        'whatsapp-notification',
        { chargeId: 'c1', trigger: 'BEFORE_DUE' },
        expect.objectContaining({ singletonKey: 'c1-manual' }),
      );
      expect(result).toEqual({ queued: true });
    });

    it('deve lançar ForbiddenException se cobrança não encontrada', async () => {
      mockPrisma.charge.findUnique.mockResolvedValueOnce(null);
      await expect(service.notifyNow('user-1', 'c1', 'ON_DUE')).rejects.toThrow(ForbiddenException);
    });

    it('deve lançar ForbiddenException se cobrança pertence a outro usuário', async () => {
      mockPrisma.charge.findUnique.mockResolvedValueOnce({ id: 'c1', creditor_id: 'outro' });
      await expect(service.notifyNow('user-1', 'c1', 'OVERDUE')).rejects.toThrow(ForbiddenException);
    });

    it('deve lançar ConflictException se MANUAL já enviado hoje', async () => {
      mockPrisma.charge.findUnique.mockResolvedValueOnce(charge);
      mockPrisma.messageHistory.findFirst.mockResolvedValueOnce({ id: 'msg-1' });
      await expect(service.notifyNow('user-1', 'c1', 'BEFORE_DUE')).rejects.toThrow(ConflictException);
      expect(mockPgBoss.send).not.toHaveBeenCalled();
    });
  });
});
