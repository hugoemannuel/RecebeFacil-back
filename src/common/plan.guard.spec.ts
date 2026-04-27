import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlanGuard } from './plan.guard';
import { PrismaService } from '../prisma/prisma.service';
import { PlanType } from '@prisma/client';

describe('PlanGuard', () => {
  let guard: PlanGuard;

  const mockReflector = { getAllAndOverride: jest.fn() };
  const mockPrismaService = {
    subscription: { findUnique: jest.fn() },
  };

  const makeContext = (userId: string | undefined, moduleName: string | null) => {
    mockReflector.getAllAndOverride.mockReturnValue(moduleName);
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user: userId ? { id: userId } : undefined, userPlan: undefined }),
      }),
    } as unknown as ExecutionContext;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanGuard,
        { provide: Reflector, useValue: mockReflector },
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    guard = module.get<PlanGuard>(PlanGuard);
  });

  afterEach(() => jest.clearAllMocks());

  it('deve permitir acesso se não há módulo requerido no decorator', async () => {
    const ctx = makeContext('user-1', null);
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('deve lançar ForbiddenException se usuário não está autenticado', async () => {
    const ctx = makeContext(undefined, 'CLIENTS');
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('deve tratar usuário sem assinatura como FREE e negar acesso a CLIENTS', async () => {
    mockPrismaService.subscription.findUnique.mockResolvedValueOnce(null);
    const ctx = makeContext('user-1', 'CLIENTS');
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('deve tratar assinatura PAST_DUE como FREE e negar acesso a REPORTS', async () => {
    mockPrismaService.subscription.findUnique.mockResolvedValueOnce({
      plan_type: PlanType.PRO,
      status: 'PAST_DUE',
    });
    const ctx = makeContext('user-1', 'REPORTS');
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('deve permitir acesso a HOME para usuário FREE', async () => {
    mockPrismaService.subscription.findUnique.mockResolvedValueOnce(null);
    const ctx = makeContext('user-1', 'HOME');
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('deve permitir acesso a CLIENTS para usuário com plano STARTER ACTIVE', async () => {
    mockPrismaService.subscription.findUnique.mockResolvedValueOnce({
      plan_type: PlanType.STARTER,
      status: 'ACTIVE',
    });
    const ctx = makeContext('user-1', 'CLIENTS');
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('deve permitir acesso a EXCEL_IMPORT para plano PRO ACTIVE', async () => {
    mockPrismaService.subscription.findUnique.mockResolvedValueOnce({
      plan_type: PlanType.PRO,
      status: 'ACTIVE',
    });
    const ctx = makeContext('user-1', 'EXCEL_IMPORT');
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('deve negar EXCEL_IMPORT para assinatura CANCELED mesmo com plano PRO', async () => {
    mockPrismaService.subscription.findUnique.mockResolvedValueOnce({
      plan_type: PlanType.PRO,
      status: 'CANCELED',
    });
    const ctx = makeContext('user-1', 'EXCEL_IMPORT');
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });
});
