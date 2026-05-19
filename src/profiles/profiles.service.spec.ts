import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProfilesService } from './profiles.service';
import { PrismaService } from '../prisma/prisma.service';
import { PlanType } from '@prisma/client';

describe('ProfilesService', () => {
  let service: ProfilesService;

  const mockPrisma = {
    creditorProfile: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    messageTemplate: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    auditLog: { create: jest.fn() },
  };

  const profileWithActiveSub = (planType: PlanType) => ({
    id: 'prof-1',
    user_id: 'user-1',
    user: { subscription: { plan_type: planType, status: 'ACTIVE' } },
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfilesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<ProfilesService>(ProfilesService);
  });

  afterEach(() => jest.clearAllMocks());

  it('deve estar definido', () => expect(service).toBeDefined());

  // ─── getProfile ──────────────────────────────────────────────
  describe('getProfile', () => {
    it('deve retornar perfil existente com templates', async () => {
      const profile = { id: 'prof-1', user: { subscription: null } };
      mockPrisma.creditorProfile.findUnique.mockResolvedValueOnce(profile);
      mockPrisma.messageTemplate.count.mockResolvedValueOnce(3);

      const result = await service.getProfile('user-1');
      expect(result.id).toBe('prof-1');
    });

    it('deve criar perfil e seed templates quando não existe', async () => {
      mockPrisma.creditorProfile.findUnique.mockResolvedValueOnce(null);
      mockPrisma.creditorProfile.create.mockResolvedValueOnce({ id: 'prof-new', user: { subscription: null } });
      mockPrisma.messageTemplate.create.mockResolvedValue({});

      const result = await service.getProfile('user-1');
      expect(result.id).toBe('prof-new');
      expect(mockPrisma.messageTemplate.create).toHaveBeenCalled();
    });

    it('deve seed templates para perfil antigo sem nenhum template', async () => {
      mockPrisma.creditorProfile.findUnique.mockResolvedValueOnce({ id: 'prof-old', user: { subscription: null } });
      mockPrisma.messageTemplate.count.mockResolvedValueOnce(0);
      mockPrisma.messageTemplate.create.mockResolvedValue({});

      await service.getProfile('user-1');
      expect(mockPrisma.messageTemplate.create).toHaveBeenCalled();
    });
  });

  // ─── updateProfile ───────────────────────────────────────────
  describe('updateProfile', () => {
    it('deve atualizar perfil e registrar AuditLog', async () => {
      const updated = { id: 'prof-1', pix_key: 'novo', pix_key_type: 'CPF' };
      mockPrisma.creditorProfile.update.mockResolvedValueOnce(updated);
      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      const result = await service.updateProfile('user-1', { pix_key: 'novo', pix_key_type: 'CPF' });
      expect(result.pix_key).toBe('novo');
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'PIX_CONFIG_UPDATED' }) }),
      );
    });
  });

  // ─── getTemplates ────────────────────────────────────────────
  describe('getTemplates', () => {
    it('deve retornar templates do perfil', async () => {
      const profile = { id: 'prof-1', user: { subscription: null } };
      mockPrisma.creditorProfile.findUnique.mockResolvedValueOnce(profile);
      mockPrisma.messageTemplate.count.mockResolvedValueOnce(2);
      mockPrisma.messageTemplate.findMany.mockResolvedValueOnce([{ id: 't1' }, { id: 't2' }]);

      const result = await service.getTemplates('user-1');
      expect(result).toHaveLength(2);
    });
  });

  // ─── createTemplate ──────────────────────────────────────────
  describe('createTemplate', () => {
    it('deve criar template para plano STARTER dentro do limite', async () => {
      mockPrisma.creditorProfile.findUnique.mockResolvedValueOnce(profileWithActiveSub(PlanType.STARTER));
      mockPrisma.messageTemplate.count.mockResolvedValueOnce(1); // 1 de 3
      mockPrisma.messageTemplate.count.mockResolvedValueOnce(1); // chamada interna
      mockPrisma.messageTemplate.create.mockResolvedValueOnce({ id: 'tmpl-new' });

      const result = await service.createTemplate('user-1', { name: 'Modelo', body: 'Olá', trigger: 'MANUAL' });
      expect(result.id).toBe('tmpl-new');
    });

    it('deve lançar ForbiddenException para plano FREE', async () => {
      mockPrisma.creditorProfile.findUnique.mockResolvedValueOnce(profileWithActiveSub(PlanType.FREE));
      mockPrisma.messageTemplate.count.mockResolvedValueOnce(0);

      await expect(service.createTemplate('user-1', { name: 'X', body: 'Y' })).rejects.toThrow(ForbiddenException);
    });

    it('deve lançar ForbiddenException quando STARTER atingiu limite de 3', async () => {
      mockPrisma.creditorProfile.findUnique.mockResolvedValueOnce(profileWithActiveSub(PlanType.STARTER));
      mockPrisma.messageTemplate.count.mockResolvedValueOnce(3); // já tem 3

      await expect(service.createTemplate('user-1', { name: 'X', body: 'Y' })).rejects.toThrow(ForbiddenException);
    });

    it('deve criar template sem limite para plano PRO', async () => {
      mockPrisma.creditorProfile.findUnique.mockResolvedValueOnce(profileWithActiveSub(PlanType.PRO));
      mockPrisma.messageTemplate.count.mockResolvedValueOnce(50);
      mockPrisma.messageTemplate.create.mockResolvedValueOnce({ id: 'tmpl-pro' });

      const result = await service.createTemplate('user-1', { name: 'X', body: 'Y' });
      expect(result.id).toBe('tmpl-pro');
    });
  });

  // ─── updateTemplate ──────────────────────────────────────────
  describe('updateTemplate', () => {
    it('deve atualizar template do próprio perfil', async () => {
      mockPrisma.creditorProfile.findUnique.mockResolvedValueOnce({ id: 'prof-1', user: { subscription: null } });
      mockPrisma.messageTemplate.count.mockResolvedValueOnce(1);
      mockPrisma.messageTemplate.findUnique.mockResolvedValueOnce({ id: 't1', creditor_profile_id: 'prof-1' });
      mockPrisma.messageTemplate.update.mockResolvedValueOnce({ id: 't1', body: 'Atualizado' });

      const result = await service.updateTemplate('user-1', 't1', { body: 'Atualizado' });
      expect(result.body).toBe('Atualizado');
    });

    it('deve lançar NotFoundException para template inexistente', async () => {
      mockPrisma.creditorProfile.findUnique.mockResolvedValueOnce({ id: 'prof-1', user: { subscription: null } });
      mockPrisma.messageTemplate.count.mockResolvedValueOnce(1);
      mockPrisma.messageTemplate.findUnique.mockResolvedValueOnce(null);

      await expect(service.updateTemplate('user-1', 'x', {})).rejects.toThrow(NotFoundException);
    });

    it('deve lançar NotFoundException para IDOR de template', async () => {
      mockPrisma.creditorProfile.findUnique.mockResolvedValueOnce({ id: 'prof-1', user: { subscription: null } });
      mockPrisma.messageTemplate.count.mockResolvedValueOnce(1);
      mockPrisma.messageTemplate.findUnique.mockResolvedValueOnce({ id: 't1', creditor_profile_id: 'outro-prof' });

      await expect(service.updateTemplate('user-1', 't1', {})).rejects.toThrow(NotFoundException);
    });
  });

  // ─── deleteTemplate ──────────────────────────────────────────
  describe('deleteTemplate', () => {
    it('deve deletar template do próprio perfil', async () => {
      mockPrisma.creditorProfile.findUnique.mockResolvedValueOnce({ id: 'prof-1', user: { subscription: null } });
      mockPrisma.messageTemplate.count.mockResolvedValueOnce(2);
      mockPrisma.messageTemplate.findUnique.mockResolvedValueOnce({ id: 't1', creditor_profile_id: 'prof-1' });
      mockPrisma.messageTemplate.delete.mockResolvedValueOnce({});

      const result = await service.deleteTemplate('user-1', 't1');
      expect(result.success).toBe(true);
    });

    it('deve lançar NotFoundException para template de outro perfil', async () => {
      mockPrisma.creditorProfile.findUnique.mockResolvedValueOnce({ id: 'prof-1', user: { subscription: null } });
      mockPrisma.messageTemplate.count.mockResolvedValueOnce(1);
      mockPrisma.messageTemplate.findUnique.mockResolvedValueOnce({ id: 't1', creditor_profile_id: 'outro' });

      await expect(service.deleteTemplate('user-1', 't1')).rejects.toThrow(NotFoundException);
    });
  });
});
