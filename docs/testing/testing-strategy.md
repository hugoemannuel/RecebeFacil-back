# Estratégia de Testes

**Framework:** Jest  
**Referência completa:** `TESTING_STRATEGY.md` na raiz do back-end

## O que Testar (Obrigatório)

| O que | Por quê |
|---|---|
| Services com lógica de negócio | Regras de domínio, planos, limites, cálculos |
| Guards (`PlanGuard`, `JwtAuthGuard`) | Controle de acesso — erro = brecha de segurança |
| Workers de fila (`AsaasWebhookWorker`, `NotificationWorker`) | Processamento assíncrono crítico |
| `CryptoService` | Criptografia em repouso — bugs comprometem credenciais |

## O que NÃO criar spec

| O que | Por quê |
|---|---|
| Controllers que só delegam | Sem lógica, sem valor de teste |
| `PrismaService` | Infraestrutura de framework |
| `AppController` | Boilerplate NestJS |
| `PgBossService` | Wrapper de biblioteca externa |

## Cobertura Mínima por Módulo

| Módulo | Arquivo | Mínimo |
|---|---|---|
| Charges | `charges.service.spec.ts` | 90% |
| Subscription | `subscription.service.spec.ts` | 90% |
| Webhook Worker | `asaas-webhook.worker.spec.ts` | 90% |
| PlanGuard | `plan.guard.spec.ts` | 85% |
| Auth | `auth.service.spec.ts` | 85% |
| Integrations | `integrations.service.spec.ts` | 85% |
| CryptoService | `crypto.service.spec.ts` | 95% |

## Regras Inegociáveis de Mock

```typescript
// ✅ Sempre mockResolvedValueOnce — nunca mockResolvedValue
prisma.charge.findUnique.mockResolvedValueOnce(chargeFixture);

// ✅ Sempre limpar mocks após cada teste
afterEach(() => jest.clearAllMocks());

// ✅ IDOR deve lançar ForbiddenException, nunca NotFoundException
await expect(service.getCharge(userId, outroUserId)).rejects.toThrow(ForbiddenException);

// ✅ bcrypt sempre mockado
jest.mock('bcrypt');
(bcrypt.hash as jest.Mock).mockResolvedValueOnce('hash');
```

## Estrutura de um Spec Completo

```typescript
describe('ChargesService', () => {
  let service: ChargesService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ChargesService,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
      ],
    }).compile();

    service = module.get(ChargesService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('createCharge', () => {
    it('deve lançar ForbiddenException se limite do plano for atingido', async () => {
      prisma.charge.count.mockResolvedValueOnce(10); // FREE limit
      await expect(service.createCharge(userId, dto)).rejects.toThrow(ForbiddenException);
    });
  });
});
```

## Comandos

```bash
npm run test          # Rodar todos os testes
npm run test:watch    # Watch mode
npm run test:cov      # Com relatório de cobertura
npm run test:debug    # Debug mode
```

## Módulos sem Spec (Débito)

Os seguintes módulos não têm testes unitários:
- `WhatsAppModule` (`whatsapp.service.ts`)
- `ProfilesModule` (`profiles.service.ts`)
- `ClientsModule` (`clients.service.ts`)
- `DashboardModule` (`dashboard.service.ts`)
- `DemoModule` (`demo.service.ts`)

Prioridade de criação de specs: `WhatsAppService` e `DashboardService` (maior complexidade).
