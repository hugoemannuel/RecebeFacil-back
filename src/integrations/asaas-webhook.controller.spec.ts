import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AsaasWebhookController } from './asaas-webhook.controller';
import { SubscriptionService } from '../subscription/subscription.service';

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
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AsaasWebhookController],
      providers: [
        { provide: ConfigService, useValue: mockConfigService },
        { provide: SubscriptionService, useValue: mockSubscriptionService },
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

    it('deve ignorar evento desconhecido e retornar received=true', async () => {
      const body = { event: 'UNKNOWN_EVENT', payment: {} };
      const result = await controller.handleWebhook(body, 'secret-token');
      expect(result).toEqual({ received: true });
      expect(mockSubscriptionService.activateSubscriptionByAsaasId).not.toHaveBeenCalled();
    });

    it('deve não chamar service quando payment.subscription está ausente em PAYMENT_CONFIRMED', async () => {
      const body = { event: 'PAYMENT_CONFIRMED', payment: { id: 'pay-x', subscription: null } };
      mockSubscriptionService.activateSubscriptionByAsaasId.mockResolvedValueOnce(undefined);

      await controller.handleWebhook(body, 'secret-token');
      expect(mockSubscriptionService.activateSubscriptionByAsaasId).not.toHaveBeenCalled();
    });
  });
});
