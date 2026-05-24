import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AsaasWebhookController } from './asaas-webhook.controller';
import { SubscriptionService } from '../subscription/subscription.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AsaasWebhookController', () => {
  let controller: AsaasWebhookController;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'ASAAS_WEBHOOK_SECRET') return 'secret-token';
      return null;
    }),
  };

  const mockSubscriptionService = {
    activateSubscriptionByAsaasId: jest.fn(),
    recordOverdueByAsaasId: jest.fn(),
    downgradeByAsaasId: jest.fn(),
    cancelSubscription: jest.fn(),
  };

  const mockPrisma = {
    charge: { updateMany: jest.fn() },
    withdrawalRecord: {
      updateMany: jest.fn(),
      findFirst: jest.fn(),
    },
    auditLog: { create: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AsaasWebhookController],
      providers: [
        { provide: ConfigService, useValue: mockConfigService },
        { provide: SubscriptionService, useValue: mockSubscriptionService },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    controller = module.get<AsaasWebhookController>(AsaasWebhookController);
  });

  afterEach(() => jest.clearAllMocks());

  it('deve estar definido', () => expect(controller).toBeDefined());

  // ─── pingWebhook ──────────────────────────────────────────────
  describe('GET /webhook', () => {
    it('deve retornar status ok', () => {
      expect(controller.pingWebhook()).toEqual({ status: 'ok' });
    });
  });

  // ─── handleWebhook ────────────────────────────────────────────
  describe('POST /webhook', () => {
    it('deve lançar UnauthorizedException com token inválido', async () => {
      await expect(
        controller.handleWebhook({ event: 'PAYMENT_CONFIRMED' }, 'wrong-token'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('deve lançar UnauthorizedException sem token', async () => {
      await expect(
        controller.handleWebhook({ event: 'PAYMENT_CONFIRMED' }, undefined as any),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('deve processar PAYMENT_CONFIRMED e ativar assinatura', async () => {
      const body = { event: 'PAYMENT_CONFIRMED', payment: { id: 'pay-1', subscription: 'sub-asaas-1' } };
      mockSubscriptionService.activateSubscriptionByAsaasId.mockResolvedValueOnce(undefined);

      const result = await controller.handleWebhook(body, 'secret-token');
      expect(result).toEqual({ received: true });
      expect(mockSubscriptionService.activateSubscriptionByAsaasId).toHaveBeenCalledWith('sub-asaas-1', 'pay-1');
    });

    it('deve processar PAYMENT_RECEIVED e ativar assinatura', async () => {
      const body = { event: 'PAYMENT_RECEIVED', payment: { id: 'pay-2', subscription: 'sub-asaas-2' } };
      mockSubscriptionService.activateSubscriptionByAsaasId.mockResolvedValueOnce(undefined);

      const result = await controller.handleWebhook(body, 'secret-token');
      expect(result).toEqual({ received: true });
      expect(mockSubscriptionService.activateSubscriptionByAsaasId).toHaveBeenCalledWith('sub-asaas-2', 'pay-2');
    });

    it('deve processar PAYMENT_OVERDUE e registrar falha', async () => {
      const body = { event: 'PAYMENT_OVERDUE', payment: { id: 'pay-3', subscription: 'sub-asaas-3' } };
      mockSubscriptionService.recordOverdueByAsaasId.mockResolvedValueOnce(undefined);

      await controller.handleWebhook(body, 'secret-token');
      expect(mockSubscriptionService.recordOverdueByAsaasId).toHaveBeenCalledWith('sub-asaas-3', 'PAYMENT_OVERDUE');
    });

    it('deve processar PAYMENT_DELETED e fazer downgrade', async () => {
      const body = { event: 'PAYMENT_DELETED', payment: { id: 'pay-4', subscription: 'sub-asaas-4' } };
      mockSubscriptionService.downgradeByAsaasId.mockResolvedValueOnce(undefined);

      await controller.handleWebhook(body, 'secret-token');
      expect(mockSubscriptionService.downgradeByAsaasId).toHaveBeenCalledWith('sub-asaas-4', 'PAYMENT_DELETED');
    });

    it('deve processar PAYMENT_REFUNDED e fazer downgrade', async () => {
      const body = { event: 'PAYMENT_REFUNDED', payment: { id: 'pay-5', subscription: 'sub-asaas-5' } };
      mockSubscriptionService.downgradeByAsaasId.mockResolvedValueOnce(undefined);

      await controller.handleWebhook(body, 'secret-token');
      expect(mockSubscriptionService.downgradeByAsaasId).toHaveBeenCalledWith('sub-asaas-5', 'PAYMENT_REFUNDED');
    });

    it('deve processar SUBSCRIPTION_DELETED e fazer downgrade', async () => {
      const body = { event: 'SUBSCRIPTION_DELETED', subscription: { id: 'sub-asaas-6' } };
      mockSubscriptionService.downgradeByAsaasId.mockResolvedValueOnce(undefined);

      await controller.handleWebhook(body, 'secret-token');
      expect(mockSubscriptionService.downgradeByAsaasId).toHaveBeenCalledWith('sub-asaas-6', 'SUBSCRIPTION_DELETED');
    });

    it('deve processar SUBSCRIPTION_CANCELED e fazer downgrade', async () => {
      const body = { event: 'SUBSCRIPTION_CANCELED', subscription: { id: 'sub-asaas-7' } };
      mockSubscriptionService.downgradeByAsaasId.mockResolvedValueOnce(undefined);

      await controller.handleWebhook(body, 'secret-token');
      expect(mockSubscriptionService.downgradeByAsaasId).toHaveBeenCalledWith('sub-asaas-7', 'SUBSCRIPTION_CANCELED');
    });

    it('deve não chamar downgrade quando subscription.id ausente em SUBSCRIPTION_DELETED', async () => {
      const body = { event: 'SUBSCRIPTION_DELETED', subscription: null };
      await controller.handleWebhook(body, 'secret-token');
      expect(mockSubscriptionService.downgradeByAsaasId).not.toHaveBeenCalled();
    });

    it('deve ignorar evento desconhecido e retornar received=true', async () => {
      const body = { event: 'UNKNOWN_EVENT', payment: {} };
      const result = await controller.handleWebhook(body, 'secret-token');
      expect(result).toEqual({ received: true });
      expect(mockSubscriptionService.activateSubscriptionByAsaasId).not.toHaveBeenCalled();
    });

    it('deve não chamar service quando payment.subscription e externalReference ausentes em PAYMENT_CONFIRMED', async () => {
      const body = { event: 'PAYMENT_CONFIRMED', payment: { id: 'pay-x', subscription: null } };

      await controller.handleWebhook(body, 'secret-token');
      expect(mockSubscriptionService.activateSubscriptionByAsaasId).not.toHaveBeenCalled();
      expect(mockPrisma.charge.updateMany).not.toHaveBeenCalled();
    });

    it('deve marcar cobrança como PAID quando PAYMENT_CONFIRMED de pagamento intermediado', async () => {
      const body = {
        event: 'PAYMENT_CONFIRMED',
        payment: { id: 'pay-intermediated', subscription: null, externalReference: 'charge-uuid-1' },
      };
      mockPrisma.charge.updateMany.mockResolvedValueOnce({ count: 1 });

      await controller.handleWebhook(body, 'secret-token');

      expect(mockSubscriptionService.activateSubscriptionByAsaasId).not.toHaveBeenCalled();
      expect(mockPrisma.charge.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'charge-uuid-1', is_intermediated: true }),
          data: expect.objectContaining({ status: 'PAID' }),
        }),
      );
    });

    it('deve marcar cobrança como PAID no PAYMENT_RECEIVED intermediado', async () => {
      const body = {
        event: 'PAYMENT_RECEIVED',
        payment: { id: 'pay-r', subscription: null, externalReference: 'charge-uuid-2' },
      };
      mockPrisma.charge.updateMany.mockResolvedValueOnce({ count: 1 });

      await controller.handleWebhook(body, 'secret-token');
      expect(mockPrisma.charge.updateMany).toHaveBeenCalled();
    });

    // ─── TRANSFER_DONE ──────────────────────────────────────────
    it('deve processar TRANSFER_DONE e confirmar WithdrawalRecord', async () => {
      const body = { event: 'TRANSFER_DONE', transfer: { id: 'tr-1', status: 'DONE' } };
      const record = { id: 'wr-1', user_id: 'user-1' };
      mockPrisma.withdrawalRecord.updateMany.mockResolvedValueOnce({ count: 1 });
      mockPrisma.withdrawalRecord.findFirst.mockResolvedValueOnce(record);
      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      const result = await controller.handleWebhook(body, 'secret-token');
      expect(result).toEqual({ received: true });
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

    it('não deve criar AuditLog em TRANSFER_DONE quando nenhum registro foi atualizado (idempotência)', async () => {
      const body = { event: 'TRANSFER_DONE', transfer: { id: 'tr-already-confirmed', status: 'DONE' } };
      mockPrisma.withdrawalRecord.updateMany.mockResolvedValueOnce({ count: 0 });

      await controller.handleWebhook(body, 'secret-token');
      expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('não deve processar TRANSFER_DONE quando transfer.id ausente', async () => {
      const body = { event: 'TRANSFER_DONE', transfer: null };
      await controller.handleWebhook(body, 'secret-token');
      expect(mockPrisma.withdrawalRecord.updateMany).not.toHaveBeenCalled();
    });

    // ─── TRANSFER_FAILED ────────────────────────────────────────
    it('deve processar TRANSFER_FAILED e marcar WithdrawalRecord como FAILED', async () => {
      const body = { event: 'TRANSFER_FAILED', transfer: { id: 'tr-2', status: 'FAILED', failReason: 'INVALID_PIX_KEY' } };
      const record = { id: 'wr-2', user_id: 'user-2' };
      mockPrisma.withdrawalRecord.updateMany.mockResolvedValueOnce({ count: 1 });
      mockPrisma.withdrawalRecord.findFirst.mockResolvedValueOnce(record);
      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      const result = await controller.handleWebhook(body, 'secret-token');
      expect(result).toEqual({ received: true });
      expect(mockPrisma.withdrawalRecord.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ asaas_transfer_id: 'tr-2', status: { not: 'FAILED' } }),
          data: expect.objectContaining({ status: 'FAILED', failure_reason: 'INVALID_PIX_KEY', failed_at: expect.any(Date) }),
        }),
      );
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'WITHDRAWAL_FAILED', user_id: 'user-2', details: expect.objectContaining({ reason: 'INVALID_PIX_KEY' }) }),
        }),
      );
    });

    it('deve usar motivo padrão em TRANSFER_FAILED quando failReason ausente', async () => {
      const body = { event: 'TRANSFER_FAILED', transfer: { id: 'tr-3', status: 'FAILED' } };
      const record = { id: 'wr-3', user_id: 'user-3' };
      mockPrisma.withdrawalRecord.updateMany.mockResolvedValueOnce({ count: 1 });
      mockPrisma.withdrawalRecord.findFirst.mockResolvedValueOnce(record);
      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      await controller.handleWebhook(body, 'secret-token');
      expect(mockPrisma.withdrawalRecord.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ failure_reason: 'Transferência recusada pelo Asaas' }),
        }),
      );
    });

    it('não deve processar TRANSFER_FAILED quando transfer.id ausente', async () => {
      const body = { event: 'TRANSFER_FAILED', transfer: null };
      await controller.handleWebhook(body, 'secret-token');
      expect(mockPrisma.withdrawalRecord.updateMany).not.toHaveBeenCalled();
    });
  });
});
