import { Test, TestingModule } from '@nestjs/testing';
import { IntegrationsService } from './integrations.service';
import { PrismaService } from '../prisma/prisma.service';
import { AsaasService } from './asaas.service';

describe('IntegrationsService', () => {
  let service: IntegrationsService;

  const mockPrisma = {
    splitTerm: { findFirst: jest.fn(), create: jest.fn() },
    integrationConfig: { upsert: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    auditLog: { create: jest.fn() },
    subscription: { findFirst: jest.fn() },
  };

  const mockAsaas = {
    createSubaccount: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntegrationsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AsaasService, useValue: mockAsaas },
      ],
    }).compile();
    service = module.get<IntegrationsService>(IntegrationsService);
  });

  afterEach(() => jest.clearAllMocks());

  it('deve estar definido', () => expect(service).toBeDefined());

  // ─── getSplitTerms ────────────────────────────────────────────
  describe('getSplitTerms', () => {
    it('deve retornar termos existentes do banco', async () => {
      mockPrisma.splitTerm.findFirst.mockResolvedValueOnce({
        version: '1.0.0',
        asaas_pix_fee: 'R$ 0,99',
        asaas_boleto_fee: 'R$ 1,99',
        asaas_card_fee: '2.99%',
        content: 'Termos...',
        is_active: true,
      });

      const result = await service.getSplitTerms();
      expect(result.version).toBe('1.0.0');
      expect(result.fees.PRO).toBe(2.0);
      expect(result.fees.UNLIMITED).toBe(1.0);
    });

    it('deve criar termo padrão quando não existe nenhum no banco', async () => {
      mockPrisma.splitTerm.findFirst.mockResolvedValueOnce(null);
      mockPrisma.splitTerm.create.mockResolvedValueOnce({
        version: '2.0.0',
        asaas_pix_fee: 'R$ 1,99',
        asaas_boleto_fee: 'R$ 1,99',
        asaas_card_fee: '2,99% + R$ 0,49',
        content: 'ver contractText',
      });

      const result = await service.getSplitTerms();
      expect(mockPrisma.splitTerm.create).toHaveBeenCalled();
      expect(result.version).toBe('2.0.0');
    });
  });

  // ─── acknowledgeSplitTerms ────────────────────────────────────
  describe('acknowledgeSplitTerms', () => {
    beforeEach(() => {
      mockAsaas.createSubaccount.mockResolvedValue({ walletId: 'wlt_ok', accountKey: 'key_ok' });
      mockPrisma.integrationConfig.update.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});
    });

    it('deve salvar aceite, criar subconta Asaas e registrar AuditLog', async () => {
      const config = { id: 'cfg-1', user_id: 'user-1' };
      mockPrisma.integrationConfig.upsert.mockResolvedValueOnce(config);

      const result = await service.acknowledgeSplitTerms('user-1', { version: '1.0.0' });
      expect(result.id).toBe('cfg-1');
      expect(mockAsaas.createSubaccount).toHaveBeenCalledWith('user-1', undefined);
      expect(mockPrisma.integrationConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { asaas_wallet_id: 'wlt_ok' } }),
      );
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'SPLIT_TERMS_ACCEPTED' }),
        }),
      );
    });

    it('deve passar documento para createSubaccount quando fornecido', async () => {
      mockPrisma.integrationConfig.upsert.mockResolvedValueOnce({ id: 'cfg-1' });

      await service.acknowledgeSplitTerms('user-1', { version: '1.0.0', document: '12345678901' });
      expect(mockAsaas.createSubaccount).toHaveBeenCalledWith('user-1', '12345678901');
    });

    it('deve registrar document_provided como true quando documento fornecido', async () => {
      mockPrisma.integrationConfig.upsert.mockResolvedValueOnce({ id: 'cfg-1' });

      await service.acknowledgeSplitTerms('user-1', { version: '1.0.0', document: '12345678901' });
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            details: expect.objectContaining({ document_provided: true }),
          }),
        }),
      );
    });

    it('deve continuar mesmo se criação da subconta falhar (degradação segura)', async () => {
      mockPrisma.integrationConfig.upsert.mockResolvedValueOnce({ id: 'cfg-1' });
      mockAsaas.createSubaccount.mockRejectedValueOnce(new Error('Asaas indisponível'));

      const result = await service.acknowledgeSplitTerms('user-1', { version: '1.0.0' });
      expect(result.id).toBe('cfg-1');
      expect(mockPrisma.auditLog.create).toHaveBeenCalled();
      // walletId não é atualizado quando createSubaccount falha
      expect(mockPrisma.integrationConfig.update).not.toHaveBeenCalled();
    });
  });

  // ─── getAutomationConfig ──────────────────────────────────────
  describe('getAutomationConfig', () => {
    it('deve retornar configuração de automação com todos os campos', async () => {
      mockPrisma.integrationConfig.findUnique.mockResolvedValueOnce({
        allows_automation: true,
        automation_days_before: 2,
        automation_days_after: 1,
        send_hour: 9,
        allow_before_due: true,
        allow_on_due: true,
        allow_overdue: false,
      });

      const result = await service.getAutomationConfig('user-1');
      expect(result?.allows_automation).toBe(true);
      expect(result?.automation_days_before).toBe(2);
      expect(result?.send_hour).toBe(9);
      expect(result?.allow_before_due).toBe(true);
      expect(result?.allow_overdue).toBe(false);
    });

    it('deve retornar null quando não há configuração', async () => {
      mockPrisma.integrationConfig.findUnique.mockResolvedValueOnce(null);
      const result = await service.getAutomationConfig('user-1');
      expect(result).toBeNull();
    });
  });

  // ─── getZapiConfig ───────────────────────────────────────────
  describe('getZapiConfig', () => {
    it('deve retornar has_credentials true e can_use_own_zapi true para UNLIMITED', async () => {
      mockPrisma.integrationConfig.findUnique.mockResolvedValueOnce({
        zapi_instance_id: 'inst-1',
        zapi_instance_token: 'tok-1',
      });
      mockPrisma.subscription.findFirst.mockResolvedValueOnce({ id: 'sub-1', plan_type: 'UNLIMITED' });
      const result = await service.getZapiConfig('user-1');
      expect(result.has_credentials).toBe(true);
      expect(result.zapi_instance_id).toBe('inst-1');
      expect(result.has_token).toBe(true);
      expect(result.can_use_own_zapi).toBe(true);
    });

    it('deve retornar can_use_own_zapi false para planos não-UNLIMITED', async () => {
      mockPrisma.integrationConfig.findUnique.mockResolvedValueOnce(null);
      mockPrisma.subscription.findFirst.mockResolvedValueOnce(null);
      const result = await service.getZapiConfig('user-1');
      expect(result.has_credentials).toBe(false);
      expect(result.can_use_own_zapi).toBe(false);
    });
  });

  // ─── updateZapiConfig ────────────────────────────────────────
  describe('updateZapiConfig', () => {
    it('deve fazer upsert para usuário UNLIMITED', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValueOnce({ id: 'sub-1', plan_type: 'UNLIMITED' });
      mockPrisma.integrationConfig.upsert.mockResolvedValueOnce({ id: 'cfg-1' });
      await service.updateZapiConfig('user-1', { instance_id: 'i1', instance_token: 't1' });
      const call = mockPrisma.integrationConfig.upsert.mock.calls[0][0];
      expect(call.update.zapi_instance_id).toBe('i1');
      expect(call.update.zapi_instance_token).toBe('t1');
    });

    it('deve lançar ForbiddenException para planos não-UNLIMITED', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.updateZapiConfig('user-1', { instance_id: 'i1', instance_token: 't1' }),
      ).rejects.toThrow('Número de WhatsApp próprio está disponível apenas no plano Unlimited.');
      expect(mockPrisma.integrationConfig.upsert).not.toHaveBeenCalled();
    });
  });

  // ─── disconnectZapi ──────────────────────────────────────────
  describe('disconnectZapi', () => {
    it('deve limpar credenciais Z-API', async () => {
      mockPrisma.integrationConfig.upsert.mockResolvedValueOnce({ id: 'cfg-1' });
      await service.disconnectZapi('user-1');
      const call = mockPrisma.integrationConfig.upsert.mock.calls[0][0];
      expect(call.update.zapi_instance_id).toBeNull();
      expect(call.update.zapi_instance_token).toBeNull();
    });
  });

  // ─── updateAutomationConfig ───────────────────────────────────
  describe('updateAutomationConfig', () => {
    it('deve fazer upsert da configuração', async () => {
      const updated = { id: 'cfg-1', allows_automation: false };
      mockPrisma.integrationConfig.upsert.mockResolvedValueOnce(updated);

      const result = await service.updateAutomationConfig('user-1', { allows_automation: false });
      expect(mockPrisma.integrationConfig.upsert).toHaveBeenCalled();
      expect(result.allows_automation).toBe(false);
    });

    it('deve criar config com defaults quando ainda não existe', async () => {
      mockPrisma.integrationConfig.upsert.mockResolvedValueOnce({ id: 'cfg-new', allows_automation: true });

      await service.updateAutomationConfig('user-1', {});
      const call = mockPrisma.integrationConfig.upsert.mock.calls[0][0];
      expect(call.create.allows_automation).toBe(true);
      expect(call.create.send_hour).toBe(9);
      expect(call.create.allow_before_due).toBe(true);
      expect(call.create.allow_on_due).toBe(true);
      expect(call.create.allow_overdue).toBe(true);
    });

    it('deve persistir send_hour quando fornecido', async () => {
      mockPrisma.integrationConfig.upsert.mockResolvedValueOnce({ id: 'cfg-1' });

      await service.updateAutomationConfig('user-1', { send_hour: 14 });
      const call = mockPrisma.integrationConfig.upsert.mock.calls[0][0];
      expect(call.update.send_hour).toBe(14);
    });

    it('deve persistir flags individuais de gatilho', async () => {
      mockPrisma.integrationConfig.upsert.mockResolvedValueOnce({ id: 'cfg-1' });

      await service.updateAutomationConfig('user-1', {
        allow_before_due: false,
        allow_on_due: true,
        allow_overdue: false,
      });
      const call = mockPrisma.integrationConfig.upsert.mock.calls[0][0];
      expect(call.update.allow_before_due).toBe(false);
      expect(call.update.allow_on_due).toBe(true);
      expect(call.update.allow_overdue).toBe(false);
    });

    it('não deve incluir send_hour no update quando não fornecido', async () => {
      mockPrisma.integrationConfig.upsert.mockResolvedValueOnce({ id: 'cfg-1' });

      await service.updateAutomationConfig('user-1', { allows_automation: true });
      const call = mockPrisma.integrationConfig.upsert.mock.calls[0][0];
      expect(call.update.send_hour).toBeUndefined();
    });
  });
});
