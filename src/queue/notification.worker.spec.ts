import { Test, TestingModule } from '@nestjs/testing';
import { NotificationWorker, NotificationJobData } from './notification.worker';
import { PgBossService, NOTIFICATION_QUEUE } from './pg-boss.service';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { TriggerType } from '@prisma/client';

describe('NotificationWorker', () => {
  let worker: NotificationWorker;

  const mockBossInstance = { createQueue: jest.fn(), work: jest.fn() };
  const mockPgBoss = { instance: mockBossInstance };

  const mockPrisma = {
    charge: { findUnique: jest.fn() },
    messageHistory: { findFirst: jest.fn(), create: jest.fn() },
  };

  const mockWhatsapp = { sendText: jest.fn() };

  const makeCharge = (overrides: Record<string, unknown> = {}) => ({
    id: 'charge-1',
    amount: 10000,
    due_date: new Date('2026-06-15'),
    debtor: { name: 'João Silva', phone: '5511999999999' },
    creditor: {
      name: 'Empresa X',
      creditor_profile: {
        business_name: 'Empresa X',
        pix_key: 'empresa@pix.com',
        message_templates: [],
      },
      integration_config: null,
    },
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationWorker,
        { provide: PgBossService, useValue: mockPgBoss },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: WhatsAppService, useValue: mockWhatsapp },
      ],
    }).compile();

    worker = module.get<NotificationWorker>(NotificationWorker);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── onApplicationBootstrap ──────────────────────────────────

  describe('onApplicationBootstrap', () => {
    it('deve criar a fila e registrar o worker', async () => {
      await worker.onApplicationBootstrap();
      expect(mockBossInstance.createQueue).toHaveBeenCalledWith(NOTIFICATION_QUEUE);
      expect(mockBossInstance.work).toHaveBeenCalledWith(
        NOTIFICATION_QUEUE,
        expect.any(Function),
      );
    });
  });

  // ─── handle ──────────────────────────────────────────────────

  describe('handle', () => {
    const jobData: NotificationJobData = { chargeId: 'charge-1', trigger: 'BEFORE_DUE' };

    it('deve enviar mensagem e registrar SENT no MessageHistory', async () => {
      mockPrisma.charge.findUnique.mockResolvedValueOnce(makeCharge());
      mockPrisma.messageHistory.findFirst.mockResolvedValueOnce(null);
      mockWhatsapp.sendText.mockResolvedValueOnce(undefined);
      mockPrisma.messageHistory.create.mockResolvedValueOnce({});

      await worker.handle(jobData);

      expect(mockWhatsapp.sendText).toHaveBeenCalledWith('5511999999999', expect.any(String), undefined);
      expect(mockPrisma.messageHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ trigger_type: TriggerType.MANUAL, status: 'SENT' }),
      });
    });

    it('não deve enviar se MANUAL já foi enviado hoje (anti-spam)', async () => {
      mockPrisma.charge.findUnique.mockResolvedValueOnce(makeCharge());
      mockPrisma.messageHistory.findFirst.mockResolvedValueOnce({ id: 'msg-1' });

      await worker.handle(jobData);

      expect(mockWhatsapp.sendText).not.toHaveBeenCalled();
      expect(mockPrisma.messageHistory.create).not.toHaveBeenCalled();
    });

    it('deve registrar FAILED e re-lançar erro se WhatsApp falhar', async () => {
      mockPrisma.charge.findUnique.mockResolvedValueOnce(makeCharge());
      mockPrisma.messageHistory.findFirst.mockResolvedValueOnce(null);
      mockWhatsapp.sendText.mockRejectedValueOnce(new Error('Z-API timeout'));
      mockPrisma.messageHistory.create.mockResolvedValueOnce({});

      await expect(worker.handle(jobData)).rejects.toThrow('Z-API timeout');

      expect(mockPrisma.messageHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          trigger_type: TriggerType.MANUAL,
          status: 'FAILED',
          error_details: 'Z-API timeout',
        }),
      });
    });

    it('deve retornar sem erro se cobrança não encontrada (idempotência)', async () => {
      mockPrisma.charge.findUnique.mockResolvedValueOnce(null);

      await expect(worker.handle(jobData)).resolves.toBeUndefined();
      expect(mockWhatsapp.sendText).not.toHaveBeenCalled();
    });

    it('deve passar credenciais do lojista quando integration_config configurado', async () => {
      const chargeWithCreds = makeCharge({
        creditor: {
          name: 'Empresa X',
          creditor_profile: { business_name: 'Empresa X', pix_key: 'pix', message_templates: [] },
          integration_config: { zapi_instance_id: 'loj-inst', zapi_instance_token: 'loj-tok' },
        },
      });
      mockPrisma.charge.findUnique.mockResolvedValueOnce(chargeWithCreds);
      mockPrisma.messageHistory.findFirst.mockResolvedValueOnce(null);
      mockWhatsapp.sendText.mockResolvedValueOnce(undefined);
      mockPrisma.messageHistory.create.mockResolvedValueOnce({});

      await worker.handle(jobData);

      expect(mockWhatsapp.sendText).toHaveBeenCalledWith(
        '5511999999999',
        expect.any(String),
        expect.objectContaining({ instanceId: 'loj-inst', token: 'loj-tok' }),
      );
    });

    it('deve usar template personalizado quando disponível', async () => {
      const chargeWithTemplate = makeCharge({
        creditor: {
          name: 'Empresa X',
          creditor_profile: {
            business_name: 'Empresa X',
            pix_key: 'empresa@pix.com',
            message_templates: [
              { trigger: 'BEFORE_DUE', is_default: true, body: 'Oi {{nome}}, vence em {{vencimento}}.' },
            ],
          },
        },
      });
      mockPrisma.charge.findUnique.mockResolvedValueOnce(chargeWithTemplate);
      mockPrisma.messageHistory.findFirst.mockResolvedValueOnce(null);
      mockWhatsapp.sendText.mockResolvedValueOnce(undefined);
      mockPrisma.messageHistory.create.mockResolvedValueOnce({});

      await worker.handle(jobData);

      expect(mockWhatsapp.sendText).toHaveBeenCalledWith(
        '5511999999999',
        expect.stringContaining('João Silva'),
        undefined,
      );
    });
  });
});
