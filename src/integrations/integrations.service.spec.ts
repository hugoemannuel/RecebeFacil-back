import { Test, TestingModule } from '@nestjs/testing';
import { IntegrationsService } from './integrations.service';
import { PrismaService } from '../prisma/prisma.service';

describe('IntegrationsService', () => {
  let service: IntegrationsService;

  const mockPrisma = {
    splitTerm: { findFirst: jest.fn(), create: jest.fn() },
    integrationConfig: { upsert: jest.fn(), findUnique: jest.fn() },
    auditLog: { create: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntegrationsService,
        { provide: PrismaService, useValue: mockPrisma },
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
        version: '1.0.0',
        asaas_pix_fee: 'R$ 0,99',
        asaas_boleto_fee: 'R$ 1,99',
        asaas_card_fee: '2.99%',
        content: 'Termos...',
      });

      const result = await service.getSplitTerms();
      expect(mockPrisma.splitTerm.create).toHaveBeenCalled();
      expect(result.version).toBe('1.0.0');
    });
  });

  // ─── acknowledgeSplitTerms ────────────────────────────────────
  describe('acknowledgeSplitTerms', () => {
    it('deve salvar aceite e registrar AuditLog', async () => {
      const config = { id: 'cfg-1', user_id: 'user-1' };
      mockPrisma.integrationConfig.upsert.mockResolvedValueOnce(config);
      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      const result = await service.acknowledgeSplitTerms('user-1', { version: '1.0.0' });
      expect(result.id).toBe('cfg-1');
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'SPLIT_TERMS_ACCEPTED' }),
        }),
      );
    });

    it('deve registrar document_provided como true quando documento fornecido', async () => {
      mockPrisma.integrationConfig.upsert.mockResolvedValueOnce({ id: 'cfg-1' });
      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      await service.acknowledgeSplitTerms('user-1', { version: '1.0.0', document: '12345678901' });
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            details: expect.objectContaining({ document_provided: true }),
          }),
        }),
      );
    });
  });

  // ─── getAutomationConfig ──────────────────────────────────────
  describe('getAutomationConfig', () => {
    it('deve retornar configuração de automação', async () => {
      mockPrisma.integrationConfig.findUnique.mockResolvedValueOnce({
        allows_automation: true,
        automation_days_before: 2,
        automation_days_after: 1,
      });

      const result = await service.getAutomationConfig('user-1');
      expect(result?.allows_automation).toBe(true);
      expect(result?.automation_days_before).toBe(2);
    });

    it('deve retornar null quando não há configuração', async () => {
      mockPrisma.integrationConfig.findUnique.mockResolvedValueOnce(null);
      const result = await service.getAutomationConfig('user-1');
      expect(result).toBeNull();
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
    });
  });
});
