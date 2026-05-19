import { Test, TestingModule } from '@nestjs/testing';
import { AutomationService } from './automation.service';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

describe('AutomationService', () => {
  let service: AutomationService;

  const mockPrisma = {
    recurringCharge: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    charge: {
      create: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
    messageHistory: { create: jest.fn() },
  };

  const mockWhatsapp = { sendText: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutomationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: WhatsAppService, useValue: mockWhatsapp },
      ],
    }).compile();
    service = module.get<AutomationService>(AutomationService);
  });

  afterEach(() => jest.clearAllMocks());

  it('deve estar definido', () => expect(service).toBeDefined());

  // ─── handleRecurringChargeGeneration ──────────────────────────
  describe('handleRecurringChargeGeneration', () => {
    it('deve gerar cobranças para regras ativas vencidas', async () => {
      mockPrisma.recurringCharge.findMany.mockResolvedValueOnce([
        {
          id: 'rule-1', creditor_id: 'user-1', amount: 10000,
          description: 'Mensalidade', next_generation_date: new Date(),
          custom_message: null, frequency: 'MONTHLY',
          max_installments: null,
          _count: { charges: 0 },
          debtors: [{ debtor: { id: 'debtor-1' } }],
        },
      ]);
      mockPrisma.charge.create.mockResolvedValueOnce({ id: 'c-new' });
      mockPrisma.recurringCharge.update.mockResolvedValueOnce({});

      await service.handleRecurringChargeGeneration();

      expect(mockPrisma.charge.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ creditor_id: 'user-1', amount: 10000, status: 'PENDING' }),
        }),
      );
      expect(mockPrisma.recurringCharge.update).toHaveBeenCalled();
    });

    it('deve desativar regra quando max_installments atingido', async () => {
      mockPrisma.recurringCharge.findMany.mockResolvedValueOnce([
        {
          id: 'rule-2', creditor_id: 'user-1', amount: 5000,
          max_installments: 3, _count: { charges: 3 },
          debtors: [],
        },
      ]);
      mockPrisma.recurringCharge.update.mockResolvedValueOnce({});

      await service.handleRecurringChargeGeneration();

      expect(mockPrisma.recurringCharge.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { active: false } }),
      );
      expect(mockPrisma.charge.create).not.toHaveBeenCalled();
    });

    it('deve funcionar sem erros quando não há regras ativas', async () => {
      mockPrisma.recurringCharge.findMany.mockResolvedValueOnce([]);
      await expect(service.handleRecurringChargeGeneration()).resolves.not.toThrow();
    });

    it('deve continuar processando outras regras quando uma falha', async () => {
      mockPrisma.recurringCharge.findMany.mockResolvedValueOnce([
        {
          id: 'rule-err', creditor_id: 'user-1', amount: 100,
          max_installments: null, _count: { charges: 0 },
          debtors: [{ debtor: { id: 'debtor-1' } }],
          next_generation_date: new Date(), frequency: 'WEEKLY',
        },
      ]);
      mockPrisma.charge.create.mockRejectedValueOnce(new Error('DB error'));

      await expect(service.handleRecurringChargeGeneration()).resolves.not.toThrow();
    });
  });

  // ─── handleDailyBillingSync ───────────────────────────────────
  describe('handleDailyBillingSync', () => {
    it('deve marcar cobranças PENDING vencidas como OVERDUE', async () => {
      mockPrisma.charge.updateMany.mockResolvedValueOnce({ count: 3 });
      // processAutomationQueue chama charge.findMany
      mockPrisma.charge.findMany.mockResolvedValue([]);

      await service.handleDailyBillingSync();

      expect(mockPrisma.charge.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'PENDING', is_intermediated: false }),
          data: { status: 'OVERDUE' },
        }),
      );
    });

    it('deve executar sem erros quando não há cobranças para processar', async () => {
      mockPrisma.charge.updateMany.mockResolvedValueOnce({ count: 0 });
      mockPrisma.charge.findMany.mockResolvedValue([]);
      await expect(service.handleDailyBillingSync()).resolves.not.toThrow();
    });

    it('deve enviar WhatsApp para cobranças elegíveis', async () => {
      mockPrisma.charge.updateMany.mockResolvedValueOnce({ count: 0 });
      mockPrisma.charge.findMany.mockResolvedValue([
        {
          id: 'c1', amount: 10000, due_date: new Date(), status: 'PENDING',
          debtor: { id: 'debtor-1', name: 'João', phone: '11999' },
          creditor: {
            name: 'Loja',
            creditor_profile: { business_name: 'Loja LTDA', pix_key: '123', message_templates: [] },
            integration_config: { allows_automation: true },
          },
        },
      ]);
      mockWhatsapp.sendText.mockResolvedValue(undefined);
      mockPrisma.messageHistory.create.mockResolvedValue({});

      await service.handleDailyBillingSync();
      expect(mockWhatsapp.sendText).toHaveBeenCalled();
    });

    it('deve continuar mesmo se WhatsApp falhar para uma cobrança', async () => {
      mockPrisma.charge.updateMany.mockResolvedValueOnce({ count: 0 });
      mockPrisma.charge.findMany.mockResolvedValue([
        {
          id: 'c1', amount: 10000, due_date: new Date(), status: 'PENDING',
          debtor: { id: 'debtor-1', name: 'João', phone: '11999' },
          creditor: {
            name: 'Loja',
            creditor_profile: { business_name: 'Loja', pix_key: '123', message_templates: [] },
            integration_config: { allows_automation: true },
          },
        },
      ]);
      mockWhatsapp.sendText.mockRejectedValue(new Error('Z-API offline'));

      await expect(service.handleDailyBillingSync()).resolves.not.toThrow();
    });
  });
});
