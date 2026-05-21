import { Test, TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AsaasService } from './asaas.service';
import { PrismaService } from '../prisma/prisma.service';
import { PlanType } from '@prisma/client';
import { of, throwError } from 'rxjs';

describe('AsaasService', () => {
  let service: AsaasService;

  const mockHttpService = { post: jest.fn(), get: jest.fn(), delete: jest.fn() };
  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'ASAAS_API_URL') return 'https://sandbox.asaas.com/api/v3';
      if (key === 'ASAAS_API_KEY') return 'test_key';
      return null;
    }),
  };
  const mockPrisma = {
    user: { findUnique: jest.fn() },
    integrationConfig: { upsert: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AsaasService,
        { provide: HttpService, useValue: mockHttpService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<AsaasService>(AsaasService);
  });

  afterEach(() => jest.clearAllMocks());

  it('deve estar definido', () => expect(service).toBeDefined());

  // ─── getOrCreateCustomer ──────────────────────────────────────
  describe('getOrCreateCustomer', () => {
    it('deve retornar asaas_customer_id existente sem chamar API', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-1', name: 'João', email: 'j@j.com',
        integration_config: { asaas_customer_id: 'cus_existing' },
        creditor_profile: null,
      });

      const result = await service.getOrCreateCustomer('user-1');
      expect(result).toBe('cus_existing');
      expect(mockHttpService.post).not.toHaveBeenCalled();
    });

    it('deve criar customer no Asaas quando não tem asaas_customer_id', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-1', name: 'João', email: 'j@j.com',
        integration_config: { asaas_customer_id: null },
        creditor_profile: { document: '12345678901' },
      });
      mockHttpService.post.mockReturnValueOnce(of({ data: { id: 'cus_new' } }));
      mockPrisma.integrationConfig.upsert.mockResolvedValueOnce({});

      const result = await service.getOrCreateCustomer('user-1');
      expect(result).toBe('cus_new');
      expect(mockPrisma.integrationConfig.upsert).toHaveBeenCalled();
    });

    it('deve lançar HttpException quando usuário não encontrado', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      await expect(service.getOrCreateCustomer('user-x')).rejects.toThrow(HttpException);
    });

    it('deve lançar HttpException quando Asaas retorna erro', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-1', name: 'X', email: 'x@x.com',
        integration_config: { asaas_customer_id: null },
        creditor_profile: null,
      });
      mockHttpService.post.mockReturnValueOnce(
        throwError(() => ({ response: { data: { errors: [{ description: 'Invalid CPF' }] } } })),
      );

      await expect(service.getOrCreateCustomer('user-1')).rejects.toThrow(HttpException);
    });
  });

  // ─── createPlanSubscription ───────────────────────────────────
  describe('createPlanSubscription', () => {
    it('deve retornar FREE_PLAN para plano FREE', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-1', name: 'X', email: 'x@x.com',
        integration_config: { asaas_customer_id: 'cus_1' },
        creditor_profile: null,
      });

      const result = await service.createPlanSubscription('user-1', PlanType.FREE, 'MONTHLY');
      expect(result).toEqual({ status: 'FREE_PLAN' });
    });

    it('deve criar assinatura no Asaas e retornar invoiceUrl', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-1', name: 'X', email: 'x@x.com',
        integration_config: { asaas_customer_id: 'cus_1' },
        creditor_profile: null,
      });
      mockHttpService.post.mockReturnValueOnce(
        of({ data: { id: 'sub_asaas', status: 'PENDING', invoiceUrl: 'https://pay.asaas.com/inv' } }),
      );

      const result = await service.createPlanSubscription('user-1', PlanType.STARTER, 'MONTHLY');
      expect(result.invoiceUrl).toBe('https://pay.asaas.com/inv');
      expect(result.asaasId).toBe('sub_asaas');
    });

    it('deve buscar URL na cobrança gerada quando assinatura não retorna URL', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-1', name: 'X', email: 'x@x.com',
        integration_config: { asaas_customer_id: 'cus_1' },
        creditor_profile: null,
      });
      mockHttpService.post.mockReturnValueOnce(
        of({ data: { id: 'sub_asaas', status: 'PENDING', invoiceUrl: null, checkoutUrl: null, bankSlipUrl: null } }),
      );
      mockHttpService.get.mockReturnValueOnce(
        of({ data: { data: [{ invoiceUrl: 'https://pay.asaas.com/charge' }] } }),
      );

      const result = await service.createPlanSubscription('user-1', PlanType.PRO, 'YEARLY');
      expect(result.invoiceUrl).toBe('https://pay.asaas.com/charge');
    });

    it('deve lançar HttpException quando criação de assinatura falha', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-1', name: 'X', email: 'x@x.com',
        integration_config: { asaas_customer_id: 'cus_1' },
        creditor_profile: null,
      });
      mockHttpService.post.mockReturnValueOnce(
        throwError(() => ({ message: 'Asaas down', response: { data: {} } })),
      );

      await expect(service.createPlanSubscription('user-1', PlanType.STARTER, 'MONTHLY')).rejects.toThrow(HttpException);
    });
  });

  // ─── createSubaccount ─────────────────────────────────────────
  describe('createSubaccount', () => {
    it('deve criar subconta e salvar walletId + accountKey', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-1', name: 'João', email: 'j@j.com', phone: '5511999',
        creditor_profile: { document: '12345678901' },
      });
      mockHttpService.post.mockReturnValueOnce(of({ data: { walletId: 'wlt_123', apiKey: 'acc_key_abc' } }));
      mockPrisma.integrationConfig.upsert.mockResolvedValueOnce({});

      const result = await service.createSubaccount('user-1');
      expect(result.walletId).toBe('wlt_123');
      expect(result.accountKey).toBe('acc_key_abc');
      expect(mockPrisma.integrationConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ asaas_wallet_id: 'wlt_123', asaas_account_key: 'acc_key_abc' }),
        }),
      );
    });

    it('deve usar documento fornecido como parâmetro sobre o do perfil', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-1', name: 'João', email: 'j@j.com', phone: '',
        creditor_profile: { document: '00000000000' },
      });
      mockHttpService.post.mockReturnValueOnce(of({ data: { walletId: 'wlt_x', apiKey: 'key_x' } }));
      mockPrisma.integrationConfig.upsert.mockResolvedValueOnce({});

      await service.createSubaccount('user-1', '99999999901');
      const call = mockHttpService.post.mock.calls[0][1];
      expect(call.cpfCnpj).toBe('99999999901');
    });

    it('deve lançar HttpException quando usuário não encontrado', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      await expect(service.createSubaccount('user-x')).rejects.toThrow(HttpException);
    });

    it('deve lançar HttpException quando Asaas retorna erro', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-1', name: 'João', email: 'j@j.com', phone: '',
        creditor_profile: null,
      });
      mockHttpService.post.mockReturnValueOnce(
        throwError(() => ({ response: { data: { errors: [{ description: 'CPF inválido' }] } } })),
      );
      await expect(service.createSubaccount('user-1')).rejects.toThrow(HttpException);
    });
  });

  // ─── createIntermediatedPayment ───────────────────────────────
  describe('createIntermediatedPayment', () => {
    const baseData = {
      debtorName: 'Ana Souza',
      debtorPhone: '5511888',
      amountCentavos: 50000,
      dueDate: new Date('2026-07-01'),
      description: 'Serviço prestado',
      chargeId: 'charge-abc',
    };

    it('deve criar cliente devedor e pagamento sem split quando walletId ausente', async () => {
      mockHttpService.post
        .mockReturnValueOnce(of({ data: { id: 'cus_debtor' } }))
        .mockReturnValueOnce(of({ data: { id: 'pay_001', invoiceUrl: 'https://asaas.com/pay_001' } }));

      const result = await service.createIntermediatedPayment(baseData);
      expect(result.asaasPaymentId).toBe('pay_001');
      expect(result.invoiceUrl).toBe('https://asaas.com/pay_001');

      const paymentPayload = mockHttpService.post.mock.calls[1][1];
      expect(paymentPayload.split).toBeUndefined();
    });

    it('deve incluir split quando walletId e platformFeePct fornecidos (PRO 2%)', async () => {
      mockHttpService.post
        .mockReturnValueOnce(of({ data: { id: 'cus_debtor' } }))
        .mockReturnValueOnce(of({ data: { id: 'pay_002', invoiceUrl: 'https://asaas.com/pay_002' } }));

      await service.createIntermediatedPayment({
        ...baseData,
        walletId: 'wlt_loja',
        platformFeePct: 2,
      });

      const paymentPayload = mockHttpService.post.mock.calls[1][1];
      expect(paymentPayload.split).toEqual([{ walletId: 'wlt_loja', percentualValue: 98 }]);
    });

    it('deve incluir split com 99% para plano UNLIMITED (taxa 1%)', async () => {
      mockHttpService.post
        .mockReturnValueOnce(of({ data: { id: 'cus_debtor' } }))
        .mockReturnValueOnce(of({ data: { id: 'pay_003', invoiceUrl: 'https://asaas.com/pay_003' } }));

      await service.createIntermediatedPayment({
        ...baseData,
        walletId: 'wlt_unlimited',
        platformFeePct: 1,
      });

      const paymentPayload = mockHttpService.post.mock.calls[1][1];
      expect(paymentPayload.split).toEqual([{ walletId: 'wlt_unlimited', percentualValue: 99 }]);
    });

    it('deve lançar HttpException quando criação do cliente devedor falha', async () => {
      mockHttpService.post.mockReturnValueOnce(
        throwError(() => ({ response: { data: { errors: [{ description: 'Telefone inválido' }] } } })),
      );
      await expect(service.createIntermediatedPayment(baseData)).rejects.toThrow(HttpException);
    });

    it('deve lançar HttpException quando criação do pagamento falha', async () => {
      mockHttpService.post
        .mockReturnValueOnce(of({ data: { id: 'cus_ok' } }))
        .mockReturnValueOnce(throwError(() => ({ response: { data: { errors: [{ description: 'Valor inválido' }] } } })));
      await expect(service.createIntermediatedPayment(baseData)).rejects.toThrow(HttpException);
    });
  });

  // ─── cancelSubscription ───────────────────────────────────────
  describe('cancelSubscription', () => {
    it('deve chamar DELETE no Asaas com o asaasId correto', async () => {
      mockHttpService.delete.mockReturnValueOnce(of({ data: {} }));
      await service.cancelSubscription('sub_asaas_1');
      expect(mockHttpService.delete).toHaveBeenCalledWith(
        expect.stringContaining('/subscriptions/sub_asaas_1'),
        expect.objectContaining({ headers: expect.any(Object) }),
      );
    });

    it('deve não lançar exceção quando Asaas falha (falha silenciosa)', async () => {
      mockHttpService.delete.mockReturnValueOnce(
        throwError(() => new Error('Asaas indisponível')),
      );
      await expect(service.cancelSubscription('sub_asaas_1')).resolves.toBeUndefined();
    });
  });
});
