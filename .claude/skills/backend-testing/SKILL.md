---
name: backend-testing
description: Guia completo de testes no back-end RecebeFácil — Jest, TestingModule NestJS, mocks de Prisma, cobertura mínima 80% (meta: 100%), cenários obrigatórios por tipo de arquivo.
when_to_use: Sempre que criar ou modificar *.service.ts, *.controller.ts, *.guard.ts, *.strategy.ts ou qualquer lógica de negócio. Todo arquivo de produção exige *.spec.ts correspondente antes de ir para produção.
---

## Regra Inegociável

Nenhum `*.service.ts`, `*.controller.ts`, `*.guard.ts` ou `*.strategy.ts` vai para produção sem o `*.spec.ts` correspondente.

**Cobertura mínima: 80% global. Meta: 100%.**  
Rodar `npm run test:cov` e conferir — thresholds estão configurados no `jest` do `package.json` e falham o build se não atingidos.

---

## Estrutura Padrão de um Spec File

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { NomeDaClasse } from './nome-da-classe.service';
import { PrismaService } from '../prisma/prisma.service';
// imports dos mocks de dependências

// Mocks de bibliotecas externas (bcrypt, etc.) — sempre no topo do arquivo:
jest.mock('bcrypt');

describe('NomeDaClasse', () => {
  let service: NomeDaClasse;

  // Mocks declarados no escopo do describe para acesso em todos os testes:
  const mockPrismaService = {
    nomeDoModel: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
  };

  const mockDependencyService = {
    metodo: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NomeDaClasse,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: DependencyService, useValue: mockDependencyService },
      ],
    }).compile();

    service = module.get<NomeDaClasse>(NomeDaClasse);
  });

  afterEach(() => jest.clearAllMocks()); // obrigatório — previne contaminação entre testes

  it('deve estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('nomeDoMetodo', () => {
    it('deve [resultado esperado] quando [condição]', async () => {
      // Arrange
      mockPrismaService.model.findUnique.mockResolvedValueOnce({ id: '1', ... });

      // Act
      const result = await service.nomeDoMetodo(args);

      // Assert
      expect(result).toEqual(expect.objectContaining({ campo: 'valor' }));
      expect(mockPrismaService.model.findUnique).toHaveBeenCalledWith({ where: { id: '1' } });
    });
  });
});
```

---

## Mocks do PrismaService

Sempre mockar o modelo inteiro com todos os métodos que o serviço usa:

```typescript
const mockPrismaService = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  charge: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
  },
  subscription: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
  // adicionar outros modelos conforme necessário
};
```

**Padrão de mock por chamada:**
```typescript
// Retorna valor uma vez (recomendado para isolar testes):
mockPrismaService.user.findUnique.mockResolvedValueOnce({ id: '1', email: 'a@b.com' });

// Retorna null (recurso não encontrado):
mockPrismaService.charge.findUnique.mockResolvedValueOnce(null);

// Lança exceção:
mockPrismaService.user.create.mockRejectedValueOnce(new Error('DB error'));
```

---

## Mock de Bibliotecas Externas

### bcrypt
```typescript
import * as bcrypt from 'bcrypt';
jest.mock('bcrypt');

// No teste:
(bcrypt.hash as jest.Mock).mockResolvedValueOnce('hashed_password');
(bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);  // senha correta
(bcrypt.compare as jest.Mock).mockResolvedValueOnce(false); // senha errada
```

### JwtService
```typescript
const mockJwtService = {
  sign: jest.fn().mockReturnValue('mock_jwt_token'),
  verify: jest.fn(),
};
{ provide: JwtService, useValue: mockJwtService }
```

### HttpService / Axios (Z-API, Asaas)
```typescript
const mockHttpService = {
  post: jest.fn().mockReturnValue(of({ data: { id: 'zapi_msg_id' } })),
  get: jest.fn().mockReturnValue(of({ data: {} })),
};
{ provide: HttpService, useValue: mockHttpService }
```

### ConfigService
```typescript
const mockConfigService = {
  get: jest.fn((key: string) => {
    const config = {
      JWT_SECRET: 'test_secret',
      ASAAS_API_KEY: 'test_key',
    };
    return config[key];
  }),
};
{ provide: ConfigService, useValue: mockConfigService }
```

---

## Testes de Service

### Cenários Obrigatórios por Módulo

**Auth:**
- `validateUser`: credenciais válidas → retorna user sem `password_hash`
- `validateUser`: senha errada → retorna `null`
- `validateUser`: e-mail não existe → retorna `null`
- `login`: validação falha → lança `UnauthorizedException`
- `login`: sucesso → retorna `access_token` + dados do user
- `register`: e-mail novo → cria user e retorna token
- `register`: e-mail existente → lança erro genérico (anti user enumeration)
- `register`: shadow user com mesmo telefone → promove (update, não create)

**Charges:**
- Criar cobrança: plano FREE abaixo do limite → sucesso
- Criar cobrança: plano FREE no limite → lança `ForbiddenException` com `LIMIT_REACHED`
- Criar cobrança: recorrência não permitida para o plano → `RECURRENCE_NOT_ALLOWED`
- Criar cobrança: debtor não existe → cria shadow user primeiro
- Listar cobranças: sempre filtra por `creditor_id` (IDOR)
- Acessar cobrança de outro usuário → `ForbiddenException`
- Cancelar cobrança própria → sucesso + auditLog
- Bulk cancel: plano FREE/STARTER → `ForbiddenException`

**Clients:**
- Criar client: plano STARTER+ → sucesso
- Listar clients: filtra por `creditor_id`
- Acessar client de outro usuário → `ForbiddenException`

**Subscription:**
- `getUserPlan`: sem assinatura → retorna FREE
- `getUserPlan`: PAST_DUE → retorna FREE efetivo
- `activatePlan`: cria/atualiza via upsert (idempotência)
- `downgradeToFree`: atualiza para FREE + cria auditLog

**Users:**
- `updatePassword`: senha atual errada → `UnauthorizedException`
- `updatePassword`: correta → hash nova senha com bcrypt 12 rounds
- `deleteAccount`: anonimiza dados (LGPD)

**Dashboard:**
- Métricas executam em paralelo (`Promise.all`) — mockar cada query separadamente
- Resultado agrega todos os dados

### Padrão IDOR (obrigatório em todo serviço com entidades)
```typescript
describe('getCharge', () => {
  it('deve retornar cobrança do próprio usuário', async () => {
    mockPrismaService.charge.findUnique.mockResolvedValueOnce({
      id: 'charge-1', creditor_id: 'user-1', amount: 10000,
    });
    const result = await service.getCharge('charge-1', 'user-1');
    expect(result.id).toBe('charge-1');
  });

  it('deve lançar ForbiddenException para cobrança de outro usuário', async () => {
    mockPrismaService.charge.findUnique.mockResolvedValueOnce({
      id: 'charge-1', creditor_id: 'outro-user',
    });
    await expect(service.getCharge('charge-1', 'user-1')).rejects.toThrow(ForbiddenException);
  });

  it('deve lançar ForbiddenException para cobrança inexistente (não 404)', async () => {
    mockPrismaService.charge.findUnique.mockResolvedValueOnce(null);
    await expect(service.getCharge('charge-x', 'user-1')).rejects.toThrow(ForbiddenException);
  });
});
```

---

## Testes de Controller

Controllers apenas delegam para o service — testar que delegam corretamente:

```typescript
describe('ChargesController', () => {
  let controller: ChargesController;

  const mockChargesService = {
    createCharge: jest.fn(),
    listCharges: jest.fn(),
    getCharge: jest.fn(),
    cancelCharge: jest.fn(),
  };

  const mockRequest = { user: { id: 'user-1' } };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChargesController],
      providers: [
        { provide: ChargesService, useValue: mockChargesService },
      ],
    }).compile();

    controller = module.get<ChargesController>(ChargesController);
  });

  afterEach(() => jest.clearAllMocks());

  describe('POST /charges', () => {
    it('deve criar cobrança e retornar resultado do service', async () => {
      const dto: CreateChargeDto = { amount: 10000, debtor_name: 'João', ... };
      const expected = { id: 'charge-1', ...dto };
      mockChargesService.createCharge.mockResolvedValueOnce(expected);

      const result = await controller.create(dto, mockRequest as any);

      expect(mockChargesService.createCharge).toHaveBeenCalledWith(dto, 'user-1');
      expect(result).toEqual(expected);
    });
  });
});
```

**Regra:** controllers **não** precisam testar regras de negócio — isso vai no service spec.

---

## Testes de Guard

```typescript
describe('PlanGuard', () => {
  let guard: PlanGuard;

  const mockReflector = { getAllAndOverride: jest.fn() };
  const mockPrismaService = {
    subscription: { findUnique: jest.fn() },
  };

  // Factory para ExecutionContext — padrão obrigatório:
  const makeContext = (userId: string | undefined, moduleName: string | null): ExecutionContext => {
    mockReflector.getAllAndOverride.mockReturnValue(moduleName);
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user: userId ? { id: userId } : undefined }),
      }),
    } as unknown as ExecutionContext;
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PlanGuard,
        { provide: Reflector, useValue: mockReflector },
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();
    guard = module.get<PlanGuard>(PlanGuard);
  });

  afterEach(() => jest.clearAllMocks());

  // Cenários obrigatórios:
  it('deve permitir se não há módulo requerido', async () => { ... });
  it('deve lançar ForbiddenException se usuário não autenticado', async () => { ... });
  it('deve tratar sem assinatura como FREE', async () => { ... });
  it('deve tratar PAST_DUE como FREE', async () => { ... });
  it('deve tratar CANCELED como FREE', async () => { ... });
  it('deve permitir HOME para FREE', async () => { ... });
  it('deve negar módulo premium para FREE', async () => { ... });
  it('deve permitir módulo premium para STARTER ACTIVE', async () => { ... });
});
```

---

## Testes de CRON Jobs (AutomationService)

```typescript
describe('AutomationService', () => {
  describe('markOverdueCharges', () => {
    it('deve atualizar cobranças PENDING vencidas para OVERDUE', async () => {
      mockPrismaService.charge.updateMany.mockResolvedValueOnce({ count: 5 });

      await service.markOverdueCharges();

      expect(mockPrismaService.charge.updateMany).toHaveBeenCalledWith({
        where: { status: 'PENDING', due_date: { lt: expect.any(Date) } },
        data: { status: 'OVERDUE' },
      });
    });

    it('deve executar sem erros quando não há cobranças vencidas', async () => {
      mockPrismaService.charge.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.markOverdueCharges()).resolves.not.toThrow();
    });
  });
});
```

---

## Testes de Webhook (Idempotência)

```typescript
describe('handleWebhookEvent', () => {
  it('deve ativar plano em PAYMENT_CONFIRMED', async () => {
    const event = { event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_123', customer: 'cus_abc' } };
    mockPrismaService.integrationConfig.findFirst.mockResolvedValueOnce({ user_id: 'user-1' });

    await service.handleWebhookEvent(event);

    expect(mockPrismaService.subscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ status: 'ACTIVE' }) })
    );
  });

  it('deve ser idempotente — processar mesmo payment_id duas vezes não duplica', async () => {
    const event = { event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_dup', customer: 'cus_abc' } };
    mockPrismaService.integrationConfig.findFirst.mockResolvedValue({ user_id: 'user-1' });
    mockPrismaService.subscription.upsert.mockResolvedValue({});

    await service.handleWebhookEvent(event);
    await service.handleWebhookEvent(event);

    // upsert garante idempotência — verificar que foi chamado com asaas_payment_id
    expect(mockPrismaService.subscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ asaas_payment_id: 'pay_dup' }),
      })
    );
  });
});
```

---

## Checklist: Cenários Obrigatórios por Arquivo

Para cada `*.spec.ts`, cobrir obrigatoriamente:

- [ ] `it('deve estar definido')` — sanity check
- [ ] **Caminho feliz** — input válido → retorna resultado correto
- [ ] **Recurso não encontrado** — retorna `ForbiddenException` (não 404)
- [ ] **IDOR** — acesso a recurso de outro usuário → `ForbiddenException`
- [ ] **Plano FREE / sem assinatura** — rejeita ação premium
- [ ] **Assinatura CANCELED ou PAST_DUE** → tratado como FREE
- [ ] **Limite de cobranças atingido** → `LIMIT_REACHED`
- [ ] **Recorrência não permitida pelo plano** → `RECURRENCE_NOT_ALLOWED`
- [ ] **Idempotência** — mesma ação duas vezes não cria duplicata
- [ ] **Auditoria** — ações críticas criam `AuditLog`
- [ ] **Erros de DB** — serviço propaga ou trata exceção corretamente

---

## Comandos

```bash
npm run test            # Executa todos os testes
npm run test:watch      # Modo watch (desenvolvimento)
npm run test:cov        # Cobertura — falha se < 80% global
npm run test:e2e        # Testes de integração
```

Conferir `coverage/lcov-report/index.html` para ver cobertura por arquivo.

---

## Anti-patterns

- Nunca usar `mockResolvedValue` sem `Once` — contamina testes seguintes
- Nunca omitir `afterEach(() => jest.clearAllMocks())`
- Nunca testar implementação interna — testar comportamento (input → output)
- Nunca usar dados de produção nos testes
- Nunca duplicar lógica do service no spec — apenas configurar cenário e assertar resultado
- Nunca criar spec vazio (`it('deve estar definido')` sozinho conta como cobertura insuficiente)
- Nunca deixar `automation.service.spec.ts` e `prisma.service.spec.ts` com apenas "deve estar definido" — expandir com cenários reais
