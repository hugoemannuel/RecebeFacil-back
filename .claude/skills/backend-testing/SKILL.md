---
name: backend-testing
description: Estratégia oficial de testes do RecebeFácil — o que testar, o que não testar, padrões Jest, mocks, cobertura por módulo crítico (não global).
when_to_use: Sempre que criar ou modificar *.service.ts, *.guard.ts, *.worker.ts, *.strategy.ts ou qualquer lógica de negócio. Consultar antes de criar qualquer spec file.
---

## Regra Central

**Cobertura percentual global NÃO é a métrica.** O objetivo é proteger comportamentos críticos de negócio com testes confiáveis e rápidos.

Consulte `TESTING_STRATEGY.md` na raiz do projeto para o plano completo.

---

## O Que Testar (e o Que NÃO Testar)

### Testar obrigatoriamente:
- Services com lógica de negócio real (validações, cálculos, regras de plano, IDOR)
- Guards (`PlanGuard`, `AuthGuard`)
- Workers de fila (`NotificationWorker`, `AsaasWebhookWorker`)
- Services de automação CRON
- Qualquer código que toque dados financeiros ou PIX

### Não criar spec para:
- Controllers que só delegam para o service (`return this.service.method(userId, dto)`)
- `PrismaService` (infraestrutura de framework)
- `AppController` (boilerplate NestJS CLI)
- DTOs puros sem lógica
- Módulos NestJS em si (registration de providers)

---

## Cobertura Mínima por Módulo Crítico

| Módulo | Mínimo |
|---|---|
| `charges/charges.service.ts` | 90% |
| `subscription/subscription.service.ts` | 90% |
| `integrations/asaas-webhook.worker.ts` | 90% |
| `integrations/asaas.service.ts` | 85% |
| `common/plan.guard.ts` | 85% |
| `auth/auth.service.ts` | 85% |
| `automation/automation.service.ts` | 80% |
| `queue/notification.worker.ts` | 80% |
| `users/users.service.ts` | 80% |
| `*.controller.ts` | Não exigido |

---

## Estrutura Padrão de Spec File

```typescript
// 1. Mocks de libs externas ANTES de qualquer import NestJS
jest.mock('bcrypt');

import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ChargesService } from './charges.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ChargesService', () => {
  let service: ChargesService;

  const mockPrisma = {
    charge: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    subscription: { findUnique: jest.fn() },
    auditLog: { create: jest.fn() },
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

  afterEach(() => jest.clearAllMocks()); // OBRIGATÓRIO

  it('deve estar definido', () => expect(service).toBeDefined());

  describe('createCharge', () => {
    it('deve criar cobrança com sucesso (plano PRO)', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce({ plan_type: 'PRO', status: 'ACTIVE' });
      mockPrisma.charge.count.mockResolvedValueOnce(0);
      mockPrisma.charge.create.mockResolvedValueOnce({ id: 'c1' });

      const result = await service.createCharge('user-1', dto);
      expect(result.success).toBe(true);
    });
  });
});
```

---

## Regras Críticas de Mock

```typescript
// CORRETO: mockResolvedValueOnce — afeta apenas o próximo call
mockPrisma.charge.findUnique.mockResolvedValueOnce({ id: 'c1', creditor_id: 'user-1' });

// ERRADO: mockResolvedValue sem Once — contamina todos os testes seguintes
mockPrisma.charge.findUnique.mockResolvedValue({ id: 'c1' }); // NUNCA
```

### bcrypt (sempre mockar — nunca rodar hash real em teste)
```typescript
jest.mock('bcrypt');
import * as bcrypt from 'bcrypt';

(bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);
(bcrypt.hash as jest.Mock).mockResolvedValueOnce('$2b$12$fakehash');
```

### HttpService (Asaas, Z-API)
```typescript
import { of, throwError } from 'rxjs';
const mockHttpService = { post: jest.fn(), get: jest.fn(), delete: jest.fn() };

mockHttpService.post.mockReturnValueOnce(of({ data: { id: 'pay_001' } }));
mockHttpService.post.mockReturnValueOnce(
  throwError(() => ({ response: { data: { errors: [{ description: 'Erro' }] } } }))
);
```

---

## Cenários Obrigatórios por Tipo

### Services com entidades (IDOR)
```
✅ Caminho feliz — retorna dado do próprio usuário
✅ IDOR → ForbiddenException (NUNCA NotFoundException — não vazar existência)
✅ Recurso inexistente → ForbiddenException
✅ Plano insuficiente → ForbiddenException com código de erro
```

### Services financeiros (charges, subscription)
```
✅ Limite de plano atingido → LIMIT_REACHED
✅ Recorrência não permitida → RECURRENCE_NOT_ALLOWED
✅ Assinatura OVERDUE/CANCELED → tratada como FREE
✅ Cálculo de taxa de split: PRO=2%, UNLIMITED=1%
✅ Idempotência: mesma operação duas vezes não duplica resultado
✅ AuditLog criado em ações críticas
✅ Rollback: se Asaas falha após criar charge local, deleta charge
```

### Workers/CRON
```
✅ Evento/job não encontrado → silencioso (idempotência)
✅ Evento já processado → ignora
✅ Falha → incrementa retry_count, relança para DLQ
✅ Opt-out WhatsApp → não envia
✅ Anti-spam: mensagem já enviada hoje → não envia
```

### Guards
```
✅ Sem decorator → permite
✅ Sem autenticação → ForbiddenException
✅ Sem assinatura → trata como FREE
✅ Status OVERDUE/CANCELED → trata como FREE
✅ Plano correto ACTIVE → permite
✅ Plano inferior → ForbiddenException
```

---

## Padrão IDOR (obrigatório em todo service com entidades)

```typescript
describe('findOne', () => {
  it('deve retornar cobrança do próprio usuário', async () => {
    mockPrisma.charge.findUnique.mockResolvedValueOnce({ id: 'c1', creditor_id: 'user-1' });
    const result = await service.findOne('user-1', 'c1');
    expect(result.id).toBe('c1');
  });

  it('deve lançar ForbiddenException para cobrança de outro usuário (IDOR)', async () => {
    mockPrisma.charge.findUnique.mockResolvedValueOnce({ id: 'c1', creditor_id: 'outro' });
    await expect(service.findOne('user-1', 'c1')).rejects.toThrow(ForbiddenException);
  });

  it('deve lançar ForbiddenException para cobrança inexistente (não 404)', async () => {
    mockPrisma.charge.findUnique.mockResolvedValueOnce(null);
    await expect(service.findOne('user-1', 'x')).rejects.toThrow(ForbiddenException);
  });
});
```

---

## Pirâmide de Testes

```
E2E (5%) — 3-5 fluxos críticos de negócio completos
Integração (35%) — banco PostgreSQL real para módulos críticos
Unitário (60%) — lógica de negócio com dependências mockadas
```

---

## Comandos

```bash
npm run test          # Suite unitária (rápida, sem banco)
npm run test:watch    # Modo watch para desenvolvimento
npm run test:cov      # Cobertura por módulo
npm run test:e2e      # Smoke tests E2E
```

---

## Anti-patterns

- `mockResolvedValue` sem `Once` — contamina testes seguintes
- Omitir `afterEach(() => jest.clearAllMocks())`
- Usar `NotFoundException` para IDOR (deve ser `ForbiddenException`)
- Rodar bcrypt real em testes (lento, não determinístico)
- Testar controllers que só delegam (valor zero)
- Criar spec para PrismaService ou AppController
- Usar cobertura global como única métrica de qualidade
