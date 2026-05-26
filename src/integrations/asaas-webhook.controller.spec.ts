import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { AsaasWebhookController } from './asaas-webhook.controller';
import { PrismaService } from '../prisma/prisma.service';
import { PgBossService } from '../queue/pg-boss.service';

const computeFingerprint = (body: any): string => {
  const entityId = body.payment?.id ?? body.subscription?.id ?? body.transfer?.id ?? 'unknown';
  const key = `${body.event ?? 'UNKNOWN'}:${entityId}`;
  return createHash('sha256').update(key).digest('hex');
};

describe('AsaasWebhookController', () => {
  let controller: AsaasWebhookController;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'ASAAS_WEBHOOK_SECRET') return 'secret-token';
      return null;
    }),
  };

  const mockPrisma = {
    webhookEvent: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  };

  const mockPgBoss = {
    send: jest.fn().mockResolvedValue('mock-job-id'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AsaasWebhookController],
      providers: [
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PgBossService, useValue: mockPgBoss },
      ],
    }).compile();
    controller = module.get<AsaasWebhookController>(AsaasWebhookController);
  });

  afterEach(() => jest.clearAllMocks());

  it('deve estar definido', () => expect(controller).toBeDefined());

  describe('GET /webhook', () => {
    it('deve retornar status ok', () => {
      expect(controller.pingWebhook()).toEqual({ status: 'ok' });
    });
  });

  describe('POST /webhook — autenticação', () => {
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
  });

  describe('POST /webhook — receipt-then-process', () => {
    const body = { event: 'PAYMENT_CONFIRMED', payment: { id: 'pay-1', subscription: 'sub-1' } };
    const savedEvent = { id: 'evt-uuid-1', processed: false };

    it('deve salvar evento e enfileirar para processamento', async () => {
      mockPrisma.webhookEvent.findUnique.mockResolvedValueOnce(null);
      mockPrisma.webhookEvent.upsert.mockResolvedValueOnce(savedEvent);

      const result = await controller.handleWebhook(body, 'secret-token');

      expect(result).toEqual({ received: true });
      expect(mockPrisma.webhookEvent.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            source: 'ASAAS',
            event_type: 'PAYMENT_CONFIRMED',
            payload: body,
          }),
        }),
      );
      expect(mockPgBoss.send).toHaveBeenCalledWith(
        'asaas-webhook',
        { webhookEventId: 'evt-uuid-1' },
      );
    });

    it('deve ignorar webhook duplicado já processado', async () => {
      mockPrisma.webhookEvent.findUnique.mockResolvedValueOnce({ id: 'evt-uuid-1', processed: true });

      const result = await controller.handleWebhook(body, 'secret-token');

      expect(result).toEqual({ received: true, duplicate: true });
      expect(mockPrisma.webhookEvent.upsert).not.toHaveBeenCalled();
      expect(mockPgBoss.send).not.toHaveBeenCalled();
    });

    it('deve enfileirar evento ainda não processado (duplicado não processado)', async () => {
      mockPrisma.webhookEvent.findUnique.mockResolvedValueOnce({ id: 'evt-uuid-1', processed: false });
      mockPrisma.webhookEvent.upsert.mockResolvedValueOnce(savedEvent);

      const result = await controller.handleWebhook(body, 'secret-token');

      expect(result).toEqual({ received: true });
      expect(mockPgBoss.send).toHaveBeenCalled();
    });

    it('deve gerar fingerprints diferentes para eventos distintos', async () => {
      const body1 = { event: 'PAYMENT_CONFIRMED', payment: { id: 'pay-A' } };
      const body2 = { event: 'PAYMENT_CONFIRMED', payment: { id: 'pay-B' } };
      const fp1 = computeFingerprint(body1);
      const fp2 = computeFingerprint(body2);
      expect(fp1).not.toEqual(fp2);
    });

    it('deve gerar o mesmo fingerprint para o mesmo evento (determinístico)', async () => {
      const fp1 = computeFingerprint(body);
      const fp2 = computeFingerprint(body);
      expect(fp1).toEqual(fp2);
    });

    it('deve usar entidade da transferência no fingerprint de TRANSFER_DONE', async () => {
      const transferBody = { event: 'TRANSFER_DONE', transfer: { id: 'tr-1' } };
      mockPrisma.webhookEvent.findUnique.mockResolvedValueOnce(null);
      mockPrisma.webhookEvent.upsert.mockResolvedValueOnce({ id: 'evt-2', processed: false });

      await controller.handleWebhook(transferBody, 'secret-token');

      expect(mockPrisma.webhookEvent.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ event_type: 'TRANSFER_DONE' }),
        }),
      );
    });

    it('deve tratar body sem event como UNKNOWN', async () => {
      const malformedBody = { payment: { id: 'pay-x' } };
      mockPrisma.webhookEvent.findUnique.mockResolvedValueOnce(null);
      mockPrisma.webhookEvent.upsert.mockResolvedValueOnce({ id: 'evt-3', processed: false });

      const result = await controller.handleWebhook(malformedBody as any, 'secret-token');
      expect(result).toEqual({ received: true });
      expect(mockPrisma.webhookEvent.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ event_type: 'UNKNOWN' }),
        }),
      );
    });
  });
});
