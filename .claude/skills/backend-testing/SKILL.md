---
name: backend-testing
description: Estratégia oficial de testes do RecebeFácil — o que testar, o que não testar, padrões Jest, mocks, cobertura por módulo crítico (não global).
when_to_use: Sempre que criar ou modificar *.service.ts, *.guard.ts, *.worker.ts, *.strategy.ts ou qualquer lógica de negócio. Consultar antes de criar qualquer spec file.
---

## Regra Central

Cobertura percentual global **não** é a métrica. O objetivo é proteger comportamentos críticos de negócio com testes confiáveis e rápidos.

## O que Testar (Obrigatório)

- Services com lógica de negócio real (charges, subscription, integrations, automation)
- Guards (`PlanGuard`, `JwtAuthGuard`)
- Workers de fila (`AsaasWebhookWorker`, `NotificationWorker`)
- Services de criptografia (`CryptoService`)
- Qualquer código que toque dados financeiros, PIX ou credenciais

## O que NÃO Criar Spec

- Controllers que só delegam (`return this.service.method(userId, dto)`)
- `PrismaService` (infraestrutura de framework)
- `AppController` (boilerplate NestJS)
- `PgBossService` (wrapper de biblioteca)
- DTOs puros sem lógica

## Cobertura Mínima por Módulo Crítico

| Módulo | Arquivo | Mínimo |
|---|---|---|
| Charges | `charges.service.ts` | 90% |
| Subscription | `subscription.service.ts` | 90% |
| Webhook Worker | `asaas-webhook.worker.ts` | 90% |
| CryptoService | `crypto.service.ts` | 95% |
| PlanGuard | `plan.guard.ts` | 85% |
| Auth | `auth.service.ts` | 85% |
| Integrations | `integrations.service.ts` | 85% |
| Automation | `automation.service.ts` | 80% |
| Users | `users.service.ts` | 80% |
| `*.controller.ts` | — | Não exigido |

## Estrutura Padrão de Spec File

```typescript
// 1. Mocks de libs externas ANTES de qualquer import NestJS
jest.mock('bcrypt');

import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, ConflictException } from '@nestjs/common';
import { ChargesService } from './charges.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ChargesService', () => {
  let service: ChargesService;

  const mockPrisma = {
    charge: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), count: jest.fn() },
    subscription: { findUnique: jest.fn() },
    auditLog: { create: jest.fn() },
    withdrawalRecord: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChargesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<ChargesService>(ChargesService);
  });

  afterEach(() => jest.clearAllMocks()); // OBRIGATÓRIO em todo describe
});
```

## Regras Críticas de Mock

```typescript
// CORRETO: mockResolvedValueOnce — afeta apenas o próximo call
mockPrisma.charge.findUnique.mockResolvedValueOnce({ id: 'c1', creditor_id: 'user-1' });

// ERRADO: mockResolvedValue sem Once — contamina todos os testes seguintes
mockPrisma.charge.findUnique.mockResolvedValue({ id: 'c1' }); // NUNCA

// bcrypt: sempre mockar — nunca rodar hash real
jest.mock('bcrypt');
import * as bcrypt from 'bcrypt';
(bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);
(bcrypt.hash as jest.Mock).mockResolvedValueOnce('$2b$12$fakehash');

// HttpService (Asaas, Z-API)
import { of, throwError } from 'rxjs';
const mockHttp = { post: jest.fn(), get: jest.fn() };
mockHttp.post.mockReturnValueOnce(of({ data: { id: 'pay_001' } }));
mockHttp.post.mockReturnValueOnce(throwError(() => new Error('Asaas error')));
```

## Cenários Obrigatórios por Tipo

### Services com entidades (IDOR)

```
✅ Caminho feliz — retorna dado do próprio usuário
✅ IDOR → ForbiddenException (NUNCA NotFoundException — não vazar existência)
✅ Recurso inexistente → ForbiddenException (não 404)
✅ Plano insuficiente → ForbiddenException
✅ SubStatus OVERDUE/PAUSED/CANCELED → tratados como FREE
```

### Services financeiros (charges, subscription, integrations)

```
✅ Limite de cobranças do plano atingido → ForbiddenException
✅ Recorrência não permitida pelo plano → ForbiddenException
✅ Assinatura OVERDUE/CANCELED → tratada como FREE
✅ AuditLog criado em ações críticas
✅ Idempotência: operação com mesmo idempotencyKey não reprocessa
✅ Race condition: saque com PENDING/PROCESSING existente → ConflictException
✅ Saldo insuficiente no Asaas → BadRequestException
✅ Chave PIX não salva em plain-text (verificar pix_key_masked)
```

### AsaasWebhookWorker

```
✅ WebhookEvent não encontrado → silencioso (não lança exceção)
✅ WebhookEvent já processado → ignorar (idempotência)
✅ Falha → incrementa retry_count, relança para pg-boss retentar
✅ PAYMENT_CONFIRMED → ativa assinatura correta
✅ TRANSFER_DONE → WithdrawalRecord.status = CONFIRMED
✅ TRANSFER_FAILED → WithdrawalRecord.status = FAILED
```

### Guards

```
✅ Sem @RequiresModule → permite acesso
✅ Sem autenticação → ForbiddenException
✅ Sem assinatura → effectivePlan = FREE
✅ Status OVERDUE/PAUSED/CANCELED → effectivePlan = FREE
✅ Plano ACTIVE correto → permite acesso
✅ Plano insuficiente → ForbiddenException com mensagem de negócio
```

### Workers/CRON (AutomationService)

```
✅ Cobrança com devedor opt-out → não envia
✅ Anti-spam: já enviou hoje → não envia
✅ Cobrança intermediada → não marcada OVERDUE pelo CRON
✅ max_installments atingido → regra desativada
```

## Padrão IDOR (obrigatório em todo service com entidades)

```typescript
describe('findOne', () => {
  it('deve retornar cobrança do próprio usuário', async () => {
    mockPrisma.charge.findUnique.mockResolvedValueOnce({ id: 'c1', creditor_id: 'user-1' });
    const result = await service.findOne('user-1', 'c1');
    expect(result.id).toBe('c1');
  });

  it('deve lançar ForbiddenException para cobrança de outro usuário', async () => {
    mockPrisma.charge.findUnique.mockResolvedValueOnce({ id: 'c1', creditor_id: 'outro' });
    await expect(service.findOne('user-1', 'c1')).rejects.toThrow(ForbiddenException);
  });

  it('deve lançar ForbiddenException para cobrança inexistente (não 404)', async () => {
    mockPrisma.charge.findUnique.mockResolvedValueOnce(null);
    await expect(service.findOne('user-1', 'x')).rejects.toThrow(ForbiddenException);
  });
});
```

## Comandos

```bash
npm run test          # Suite unitária
npm run test:watch    # Modo watch
npm run test:cov      # Cobertura por módulo
npm run test:e2e      # Smoke tests E2E
```

## Anti-patterns

- `mockResolvedValue` sem `Once` — contamina testes seguintes
- Omitir `afterEach(() => jest.clearAllMocks())`
- Usar `NotFoundException` para IDOR (deve ser `ForbiddenException`)
- Rodar bcrypt real em testes (lento, não determinístico)
- Testar controllers que só delegam (valor zero)
- Criar spec para PrismaService ou AppController
- Usar cobertura global como única métrica de qualidade
- Usar `PAST_DUE` em mocks — o enum correto é `OVERDUE`
