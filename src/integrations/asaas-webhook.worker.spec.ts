import { Test, TestingModule } from '@nestjs/testing';
import { AsaasWebhookWorker } from './asaas-webhook.worker';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { PgBossService } from '../queue/pg-boss.service';

describe('AsaasWebhookWorker', () => {
  let worker: AsaasWebhookWorker;

  const mockPrisma = {
    webhookEvent: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    charge: { updateMany: jest.fn() },
    withdrawalRecord: {
      updateMany: jest.fn(),
      findFirst: jest.fn(),
    },
    auditLog: { create: jest.fn() },
  };

  const mockSubscriptionService = {
    activateSubscriptionByAsaasId: jest.fn(),
    recordOverdueByAsaasId: jest.fn(),
    downgradeByAsaasId: jest.fn(),
  };

  const mockPgBoss = {
    ready: jest.fn().mockResolvedValue(undefined),
    instance: {
      createQueue: jest.fn().mockResolvedValue(undefined),
      work: jest.fn().mockResolvedValue('worker-id'),
    },
    send: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AsaasWebhookWorker,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SubscriptionService, useValue: mockSubscriptionService },
        { provide: PgBossService, useValue: mockPgBoss },
      ],
    }).compile();
    worker = module.get<AsaasWebhookWorker>(AsaasWebhookWorker);
  });

  afterEach(() => jest.clearAllMocks());

  it('deve estar definido', () => expect(worker).toBeDefined());

  // ─── onApplicationBootstrap ───────────────────────────────────
  describe('onApplicationBootstrap', () => {
    it('deve registrar filas e worker no pg-boss', async () => {
      await worker.onApplicationBootstrap();
      expect(mockPgBoss.ready).toHaveBeenCalled();
      expect(mockPgBoss.instance.createQueue).toHaveBeenCalledWith('asaas-webhook-dlq');
      expect(mockPgBoss.instance.createQueue).toHaveBeenCalledWith('asaas-webhook', expect.objectContaining({
        retryLimit: 5,
        deadLetter: 'asaas-webhook-dlq',
      }));
      expect(mockPgBoss.instance.work).toHaveBeenCalledWith('asaas-webhook', expect.any(Function));
    });
  });

  // ─── processEvent — idempotência ─────────────────────────────
  describe('processEvent — idempotência', () => {
    it('deve ignorar evento não encontrado', async () => {
      mockPrisma.webhookEvent.findUnique.mockResolvedValueOnce(null);
      await worker.processEvent('nonexistent-id');
      expect(mockPrisma.webhookEvent.update).not.toHaveBeenCalled();
    });

    it('deve ignorar evento já processado', async () => {
      mockPrisma.webhookEvent.findUnique.mockResolvedValueOnce({
        id: 'evt-1', processed: true, event_type: 'PAYMENT_CONFIRMED', payload: {},
      });
      await worker.processEvent('evt-1');
      expect(mockPrisma.webhookEvent.update).not.toHaveBeenCalled();
    });

    it('deve marcar evento como processado após sucesso', async () => {
      mockPrisma.webhookEvent.findUnique.mockResolvedValueOnce({
        id: 'evt-ok', processed: false, event_type: 'UNKNOWN_EVENT', payload: {},
      });
      mockPrisma.webhookEvent.update.mockResolvedValueOnce({});

      await worker.processEvent('evt-ok');

      expect(mockPrisma.webhookEvent.update).toHaveBeenCalledWith({
        where: { id: 'evt-ok' },
        data: expect.objectContaining({ processed: true, processed_at: expect.any(Date) }),
      });
    });

    it('deve incrementar retry_count e relançar erro em caso de falha', async () => {
      const error = new Error('DB error');
      mockPrisma.webhookEvent.findUnique.mockResolvedValueOnce({
        id: 'evt-fail', processed: false, event_type: 'PAYMENT_CONFIRMED',
        payload: { payment: { id: 'pay-1', subscription: 'sub-1' } },
      });
      mockSubscriptionService.activateSubscriptionByAsaasId.mockRejectedValueOnce(error);
      mockPrisma.webhookEvent.update.mockResolvedValueOnce({});

      await expect(worker.processEvent('evt-fail')).rejects.toThrow('DB error');

      expect(mockPrisma.webhookEvent.update).toHaveBeenCalledWith({
        where: { id: 'evt-fail' },
        data: expect.objectContaining({ retry_count: { increment: 1 }, error: 'DB error' }),
      });
    });
  });

  // ─── PAYMENT_CONFIRMED ────────────────────────────────────────
  describe('PAYMENT_CONFIRMED / PAYMENT_RECEIVED', () => {
    it('deve ativar assinatura via SubscriptionService', async () => {
      const event = {
        id: 'evt-pc', processed: false, event_type: 'PAYMENT_CONFIRMED',
        payload: { payment: { id: 'pay-1', subscription: 'sub-asaas-1' } },
      };
      mockPrisma.webhookEvent.findUnique.mockResolvedValueOnce(event);
      mockSubscriptionService.activateSubscriptionByAsaasId.mockResolvedValueOnce(undefined);
      mockPrisma.webhookEvent.update.mockResolvedValueOnce({});

      await worker.processEvent('evt-pc');
      expect(mockSubscriptionService.activateSubscriptionByAsaasId).toHaveBeenCalledWith('sub-asaas-1', 'pay-1');
    });

    it('deve atualizar cobrança intermediada quando externalReference presente', async () => {
      const event = {
        id: 'evt-intermediated', processed: false, event_type: 'PAYMENT_CONFIRMED',
        payload: { payment: { id: 'pay-i', subscription: null, externalReference: 'charge-uuid-1' } },
      };
      mockPrisma.webhookEvent.findUnique.mockResolvedValueOnce(event);
      mockPrisma.charge.updateMany.mockResolvedValueOnce({ count: 1 });
      mockPrisma.webhookEvent.update.mockResolvedValueOnce({});

      await worker.processEvent('evt-intermediated');
      expect(mockPrisma.charge.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'charge-uuid-1', is_intermediated: true }),
          data: expect.objectContaining({ status: 'PAID' }),
        }),
      );
    });

    it('não deve chamar nada quando payment.subscription e externalReference ausentes', async () => {
      const event = {
        id: 'evt-no-ref', processed: false, event_type: 'PAYMENT_CONFIRMED',
        payload: { payment: { id: 'pay-x', subscription: null } },
      };
      mockPrisma.webhookEvent.findUnique.mockResolvedValueOnce(event);
      mockPrisma.webhookEvent.update.mockResolvedValueOnce({});

      await worker.processEvent('evt-no-ref');
      expect(mockSubscriptionService.activateSubscriptionByAsaasId).not.toHaveBeenCalled();
      expect(mockPrisma.charge.updateMany).not.toHaveBeenCalled();
    });

    it('deve processar PAYMENT_RECEIVED da mesma forma que PAYMENT_CONFIRMED', async () => {
      const event = {
        id: 'evt-pr', processed: false, event_type: 'PAYMENT_RECEIVED',
        payload: { payment: { id: 'pay-2', subscription: 'sub-asaas-2' } },
      };
      mockPrisma.webhookEvent.findUnique.mockResolvedValueOnce(event);
      mockSubscriptionService.activateSubscriptionByAsaasId.mockResolvedValueOnce(undefined);
      mockPrisma.webhookEvent.update.mockResolvedValueOnce({});

      await worker.processEvent('evt-pr');
      expect(mockSubscriptionService.activateSubscriptionByAsaasId).toHaveBeenCalledWith('sub-asaas-2', 'pay-2');
    });
  });

  // ─── PAYMENT_OVERDUE ──────────────────────────────────────────
  describe('PAYMENT_OVERDUE', () => {
    it('deve chamar recordOverdueByAsaasId com o asaas_id', async () => {
      const event = {
        id: 'evt-overdue', processed: false, event_type: 'PAYMENT_OVERDUE',
        payload: { payment: { id: 'pay-3', subscription: 'sub-asaas-3' } },
      };
      mockPrisma.webhookEvent.findUnique.mockResolvedValueOnce(event);
      mockSubscriptionService.recordOverdueByAsaasId.mockResolvedValueOnce(undefined);
      mockPrisma.webhookEvent.update.mockResolvedValueOnce({});

      await worker.processEvent('evt-overdue');
      expect(mockSubscriptionService.recordOverdueByAsaasId).toHaveBeenCalledWith('sub-asaas-3', 'PAYMENT_OVERDUE');
    });

    it('não deve fazer downgrade quando subscription ausente', async () => {
      const event = {
        id: 'evt-overdue-no-sub', processed: false, event_type: 'PAYMENT_OVERDUE',
        payload: { payment: { id: 'pay-z' } },
      };
      mockPrisma.webhookEvent.findUnique.mockResolvedValueOnce(event);
      mockPrisma.webhookEvent.update.mockResolvedValueOnce({});

      await worker.processEvent('evt-overdue-no-sub');
      expect(mockSubscriptionService.recordOverdueByAsaasId).not.toHaveBeenCalled();
    });
  });

  // ─── PAYMENT_DELETED / PAYMENT_REFUNDED ───────────────────────
  describe('PAYMENT_DELETED / PAYMENT_REFUNDED', () => {
    it('deve chamar downgradeByAsaasId em PAYMENT_DELETED', async () => {
      const event = {
        id: 'evt-deleted', processed: false, event_type: 'PAYMENT_DELETED',
        payload: { payment: { id: 'pay-4', subscription: 'sub-asaas-4' } },
      };
      mockPrisma.webhookEvent.findUnique.mockResolvedValueOnce(event);
      mockSubscriptionService.downgradeByAsaasId.mockResolvedValueOnce(undefined);
      mockPrisma.webhookEvent.update.mockResolvedValueOnce({});

      await worker.processEvent('evt-deleted');
      expect(mockSubscriptionService.downgradeByAsaasId).toHaveBeenCalledWith('sub-asaas-4', 'PAYMENT_DELETED');
    });

    it('deve chamar downgradeByAsaasId em PAYMENT_REFUNDED', async () => {
      const event = {
        id: 'evt-refunded', processed: false, event_type: 'PAYMENT_REFUNDED',
        payload: { payment: { id: 'pay-5', subscription: 'sub-asaas-5' } },
      };
      mockPrisma.webhookEvent.findUnique.mockResolvedValueOnce(event);
      mockSubscriptionService.downgradeByAsaasId.mockResolvedValueOnce(undefined);
      mockPrisma.webhookEvent.update.mockResolvedValueOnce({});

      await worker.processEvent('evt-refunded');
      expect(mockSubscriptionService.downgradeByAsaasId).toHaveBeenCalledWith('sub-asaas-5', 'PAYMENT_REFUNDED');
    });
  });

  // ─── SUBSCRIPTION_DELETED / SUBSCRIPTION_CANCELED ────────────
  describe('SUBSCRIPTION_DELETED / SUBSCRIPTION_CANCELED', () => {
    it('deve chamar downgradeByAsaasId em SUBSCRIPTION_DELETED', async () => {
      const event = {
        id: 'evt-sub-del', processed: false, event_type: 'SUBSCRIPTION_DELETED',
        payload: { subscription: { id: 'sub-asaas-6' } },
      };
      mockPrisma.webhookEvent.findUnique.mockResolvedValueOnce(event);
      mockSubscriptionService.downgradeByAsaasId.mockResolvedValueOnce(undefined);
      mockPrisma.webhookEvent.update.mockResolvedValueOnce({});

      await worker.processEvent('evt-sub-del');
      expect(mockSubscriptionService.downgradeByAsaasId).toHaveBeenCalledWith('sub-asaas-6', 'SUBSCRIPTION_DELETED');
    });

    it('não deve chamar downgrade quando subscription.id ausente', async () => {
      const event = {
        id: 'evt-sub-null', processed: false, event_type: 'SUBSCRIPTION_DELETED',
        payload: { subscription: null },
      };
      mockPrisma.webhookEvent.findUnique.mockResolvedValueOnce(event);
      mockPrisma.webhookEvent.update.mockResolvedValueOnce({});

      await worker.processEvent('evt-sub-null');
      expect(mockSubscriptionService.downgradeByAsaasId).not.toHaveBeenCalled();
    });
  });

  // ─── TRANSFER_DONE ────────────────────────────────────────────
  describe('TRANSFER_DONE', () => {
    it('deve confirmar WithdrawalRecord e criar AuditLog', async () => {
      const record = { id: 'wr-1', user_id: 'user-1' };
      const event = {
        id: 'evt-tr-done', processed: false, event_type: 'TRANSFER_DONE',
        payload: { transfer: { id: 'tr-1', status: 'DONE' } },
      };
      mockPrisma.webhookEvent.findUnique.mockResolvedValueOnce(event);
      mockPrisma.withdrawalRecord.updateMany.mockResolvedValueOnce({ count: 1 });
      mockPrisma.withdrawalRecord.findFirst.mockResolvedValueOnce(record);
      mockPrisma.auditLog.create.mockResolvedValueOnce({});
      mockPrisma.webhookEvent.update.mockResolvedValueOnce({});

      await worker.processEvent('evt-tr-done');
      expect(mockPrisma.withdrawalRecord.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ asaas_transfer_id: 'tr-1', status: { not: 'CONFIRMED' } }),
          data: expect.objectContaining({ status: 'CONFIRMED', confirmed_at: expect.any(Date) }),
        }),
      );
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'WITHDRAWAL_CONFIRMED', user_id: 'user-1' }),
        }),
      );
    });

    it('não deve criar AuditLog quando nenhum registro foi atualizado (idempotência)', async () => {
      const event = {
        id: 'evt-tr-done-idem', processed: false, event_type: 'TRANSFER_DONE',
        payload: { transfer: { id: 'tr-already', status: 'DONE' } },
      };
      mockPrisma.webhookEvent.findUnique.mockResolvedValueOnce(event);
      mockPrisma.withdrawalRecord.updateMany.mockResolvedValueOnce({ count: 0 });
      mockPrisma.webhookEvent.update.mockResolvedValueOnce({});

      await worker.processEvent('evt-tr-done-idem');
      expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('não deve processar quando transfer.id ausente', async () => {
      const event = {
        id: 'evt-tr-done-null', processed: false, event_type: 'TRANSFER_DONE',
        payload: { transfer: null },
      };
      mockPrisma.webhookEvent.findUnique.mockResolvedValueOnce(event);
      mockPrisma.webhookEvent.update.mockResolvedValueOnce({});

      await worker.processEvent('evt-tr-done-null');
      expect(mockPrisma.withdrawalRecord.updateMany).not.toHaveBeenCalled();
    });
  });

  // ─── TRANSFER_FAILED ──────────────────────────────────────────
  describe('TRANSFER_FAILED', () => {
    it('deve marcar WithdrawalRecord como FAILED com failReason', async () => {
      const record = { id: 'wr-2', user_id: 'user-2' };
      const event = {
        id: 'evt-tr-fail', processed: false, event_type: 'TRANSFER_FAILED',
        payload: { transfer: { id: 'tr-2', status: 'FAILED', failReason: 'INVALID_PIX_KEY' } },
      };
      mockPrisma.webhookEvent.findUnique.mockResolvedValueOnce(event);
      mockPrisma.withdrawalRecord.updateMany.mockResolvedValueOnce({ count: 1 });
      mockPrisma.withdrawalRecord.findFirst.mockResolvedValueOnce(record);
      mockPrisma.auditLog.create.mockResolvedValueOnce({});
      mockPrisma.webhookEvent.update.mockResolvedValueOnce({});

      await worker.processEvent('evt-tr-fail');
      expect(mockPrisma.withdrawalRecord.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FAILED', failure_reason: 'INVALID_PIX_KEY' }),
        }),
      );
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'WITHDRAWAL_FAILED',
            details: expect.objectContaining({ reason: 'INVALID_PIX_KEY' }),
          }),
        }),
      );
    });

    it('deve usar motivo padrão quando failReason ausente', async () => {
      const record = { id: 'wr-3', user_id: 'user-3' };
      const event = {
        id: 'evt-tr-fail-no-reason', processed: false, event_type: 'TRANSFER_FAILED',
        payload: { transfer: { id: 'tr-3', status: 'FAILED' } },
      };
      mockPrisma.webhookEvent.findUnique.mockResolvedValueOnce(event);
      mockPrisma.withdrawalRecord.updateMany.mockResolvedValueOnce({ count: 1 });
      mockPrisma.withdrawalRecord.findFirst.mockResolvedValueOnce(record);
      mockPrisma.auditLog.create.mockResolvedValueOnce({});
      mockPrisma.webhookEvent.update.mockResolvedValueOnce({});

      await worker.processEvent('evt-tr-fail-no-reason');
      expect(mockPrisma.withdrawalRecord.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ failure_reason: 'Transferência recusada pelo Asaas' }),
        }),
      );
    });

    it('não deve processar quando transfer.id ausente', async () => {
      const event = {
        id: 'evt-tr-fail-null', processed: false, event_type: 'TRANSFER_FAILED',
        payload: { transfer: null },
      };
      mockPrisma.webhookEvent.findUnique.mockResolvedValueOnce(event);
      mockPrisma.webhookEvent.update.mockResolvedValueOnce({});

      await worker.processEvent('evt-tr-fail-null');
      expect(mockPrisma.withdrawalRecord.updateMany).not.toHaveBeenCalled();
    });
  });

  // ─── PAYMENT_RESTORED ─────────────────────────────────────────
  describe('PAYMENT_RESTORED', () => {
    it('deve reativar assinatura quando pagamento é restaurado', async () => {
      const event = {
        id: 'evt-restored', processed: false, event_type: 'PAYMENT_RESTORED',
        payload: { payment: { id: 'pay-restored', subscription: 'sub-asaas-restored' } },
      };
      mockPrisma.webhookEvent.findUnique.mockResolvedValueOnce(event);
      mockSubscriptionService.activateSubscriptionByAsaasId.mockResolvedValueOnce(undefined);
      mockPrisma.webhookEvent.update.mockResolvedValueOnce({});

      await worker.processEvent('evt-restored');
      expect(mockSubscriptionService.activateSubscriptionByAsaasId).toHaveBeenCalledWith(
        'sub-asaas-restored',
        'pay-restored',
      );
    });

    it('não deve processar quando subscription ausente no payment', async () => {
      const event = {
        id: 'evt-restored-no-sub', processed: false, event_type: 'PAYMENT_RESTORED',
        payload: { payment: { id: 'pay-x' } },
      };
      mockPrisma.webhookEvent.findUnique.mockResolvedValueOnce(event);
      mockPrisma.webhookEvent.update.mockResolvedValueOnce({});

      await worker.processEvent('evt-restored-no-sub');
      expect(mockSubscriptionService.activateSubscriptionByAsaasId).not.toHaveBeenCalled();
    });
  });
});
