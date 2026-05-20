import { Test, TestingModule } from '@nestjs/testing';
import { addDays } from 'date-fns';
import { AutomationService } from './automation.service';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

const makeConfig = (overrides: Partial<Record<string, any>> = {}) => ({
  user_id: 'user-1',
  allows_automation: true,
  send_hour: 9,
  automation_days_before: 2,
  automation_days_after: 1,
  allow_before_due: true,
  allow_on_due: true,
  allow_overdue: true,
  ...overrides,
});

const makeCharge = (overrides: Partial<Record<string, any>> = {}) => ({
  id: 'c1',
  amount: 10000,
  due_date: new Date(),
  status: 'PENDING',
  creditor_id: 'user-1',
  messages: [],
  debtor: { id: 'debtor-1', name: 'João', phone: '5511999999999' },
  creditor: {
    name: 'Loja',
    creditor_profile: { business_name: 'Loja LTDA', pix_key: '123', message_templates: [] },
    integration_config: makeConfig(),
  },
  ...overrides,
});

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
    integrationConfig: {
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
    beforeEach(() => {
      // Fixa o getBRTHour para retornar 9 em todos os testes deste bloco
      jest.spyOn(service, 'getBRTHour').mockReturnValue(9);
    });

    it('deve marcar cobranças PENDING vencidas como OVERDUE', async () => {
      mockPrisma.charge.updateMany.mockResolvedValueOnce({ count: 3 });
      mockPrisma.integrationConfig.findMany.mockResolvedValueOnce([]);

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
      mockPrisma.integrationConfig.findMany.mockResolvedValueOnce([]);

      await expect(service.handleDailyBillingSync()).resolves.not.toThrow();
    });

    it('deve enviar WhatsApp para cobrança ON_DUE elegível', async () => {
      mockPrisma.charge.updateMany.mockResolvedValueOnce({ count: 0 });
      mockPrisma.integrationConfig.findMany.mockResolvedValueOnce([makeConfig()]);
      mockPrisma.charge.findMany.mockResolvedValueOnce([
        makeCharge({ due_date: new Date(), status: 'PENDING', messages: [] }),
      ]);
      mockWhatsapp.sendText.mockResolvedValue(undefined);
      mockPrisma.messageHistory.create.mockResolvedValue({});

      await service.handleDailyBillingSync();

      expect(mockWhatsapp.sendText).toHaveBeenCalledTimes(1);
    });

    it('deve continuar mesmo se WhatsApp falhar para uma cobrança', async () => {
      mockPrisma.charge.updateMany.mockResolvedValueOnce({ count: 0 });
      mockPrisma.integrationConfig.findMany.mockResolvedValueOnce([makeConfig()]);
      mockPrisma.charge.findMany.mockResolvedValueOnce([
        makeCharge({ due_date: new Date(), status: 'PENDING', messages: [] }),
      ]);
      mockWhatsapp.sendText.mockRejectedValue(new Error('Z-API offline'));
      mockPrisma.messageHistory.create.mockResolvedValue({});

      await expect(service.handleDailyBillingSync()).resolves.not.toThrow();
    });

    // ─── send_hour ────────────────────────────────────────────────
    it('não deve processar automação quando nenhum credor tem send_hour da hora atual', async () => {
      mockPrisma.charge.updateMany.mockResolvedValueOnce({ count: 0 });
      // send_hour=14, mas hora atual mockada é 9
      mockPrisma.integrationConfig.findMany.mockResolvedValueOnce([]);

      await service.handleDailyBillingSync();

      expect(mockPrisma.charge.findMany).not.toHaveBeenCalled();
    });

    it('deve processar credor cujo send_hour bate com a hora BRT atual', async () => {
      mockPrisma.charge.updateMany.mockResolvedValueOnce({ count: 0 });
      mockPrisma.integrationConfig.findMany.mockResolvedValueOnce([makeConfig({ send_hour: 9 })]);
      mockPrisma.charge.findMany.mockResolvedValueOnce([]);

      await service.handleDailyBillingSync();

      expect(mockPrisma.integrationConfig.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ send_hour: 9 }) }),
      );
    });

    // ─── flags por gatilho ────────────────────────────────────────
    it('não deve enviar BEFORE_DUE quando allow_before_due = false', async () => {
      mockPrisma.charge.updateMany.mockResolvedValueOnce({ count: 0 });
      mockPrisma.integrationConfig.findMany.mockResolvedValueOnce([
        makeConfig({ allow_before_due: false, automation_days_before: 2 }),
      ]);
      // Cobrança vence em 2 dias (BEFORE_DUE)
      mockPrisma.charge.findMany.mockResolvedValueOnce([
        makeCharge({ due_date: addDays(new Date(), 2), status: 'PENDING', messages: [] }),
      ]);

      await service.handleDailyBillingSync();

      expect(mockWhatsapp.sendText).not.toHaveBeenCalled();
    });

    it('não deve enviar ON_DUE quando allow_on_due = false', async () => {
      mockPrisma.charge.updateMany.mockResolvedValueOnce({ count: 0 });
      mockPrisma.integrationConfig.findMany.mockResolvedValueOnce([
        makeConfig({ allow_on_due: false }),
      ]);
      mockPrisma.charge.findMany.mockResolvedValueOnce([
        makeCharge({ due_date: new Date(), status: 'PENDING', messages: [] }),
      ]);

      await service.handleDailyBillingSync();

      expect(mockWhatsapp.sendText).not.toHaveBeenCalled();
    });

    it('não deve enviar OVERDUE quando allow_overdue = false', async () => {
      mockPrisma.charge.updateMany.mockResolvedValueOnce({ count: 0 });
      mockPrisma.integrationConfig.findMany.mockResolvedValueOnce([
        makeConfig({ allow_overdue: false, automation_days_after: 1 }),
      ]);
      // Cobrança venceu ontem (OVERDUE)
      mockPrisma.charge.findMany.mockResolvedValueOnce([
        makeCharge({ due_date: addDays(new Date(), -1), status: 'OVERDUE', messages: [] }),
      ]);

      await service.handleDailyBillingSync();

      expect(mockWhatsapp.sendText).not.toHaveBeenCalled();
    });

    it('não deve enviar quando master switch allows_automation = false', async () => {
      mockPrisma.charge.updateMany.mockResolvedValueOnce({ count: 0 });
      // Query Prisma já filtra allows_automation = true, então retorna []
      mockPrisma.integrationConfig.findMany.mockResolvedValueOnce([]);

      await service.handleDailyBillingSync();

      expect(mockWhatsapp.sendText).not.toHaveBeenCalled();
    });

    it('não deve enviar se a cobrança já recebeu mensagem ON_DUE hoje (anti-spam)', async () => {
      mockPrisma.charge.updateMany.mockResolvedValueOnce({ count: 0 });
      mockPrisma.integrationConfig.findMany.mockResolvedValueOnce([makeConfig()]);
      mockPrisma.charge.findMany.mockResolvedValueOnce([
        makeCharge({
          due_date: new Date(),
          status: 'PENDING',
          messages: [{ trigger_type: 'AUTO_REMINDER_DUE', sent_at: new Date() }],
        }),
      ]);

      await service.handleDailyBillingSync();

      expect(mockWhatsapp.sendText).not.toHaveBeenCalled();
    });

    it('deve usar automation_days_before do config para BEFORE_DUE', async () => {
      mockPrisma.charge.updateMany.mockResolvedValueOnce({ count: 0 });
      mockPrisma.integrationConfig.findMany.mockResolvedValueOnce([
        makeConfig({ automation_days_before: 3 }),
      ]);
      // Cobrança em 3 dias → deve disparar BEFORE_DUE
      mockPrisma.charge.findMany.mockResolvedValueOnce([
        makeCharge({ due_date: addDays(new Date(), 3), status: 'PENDING', messages: [] }),
      ]);
      mockWhatsapp.sendText.mockResolvedValue(undefined);
      mockPrisma.messageHistory.create.mockResolvedValue({});

      await service.handleDailyBillingSync();

      expect(mockWhatsapp.sendText).toHaveBeenCalledTimes(1);
    });
  });
});
