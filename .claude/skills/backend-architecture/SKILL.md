---
name: backend-architecture
description: Arquitetura NestJS do RecebeFácil — módulos, controllers, services, guards e padrões de código. Use ao criar qualquer arquivo no back-end.
when_to_use: Quando criar controllers, services, modules, DTOs, guards ou qualquer novo arquivo no back-end NestJS.
---

## Estrutura de Módulos

```
src/
  app.module.ts          ← Root: ThrottlerModule global + ThrottlerGuard como APP_GUARD
  main.ts                ← helmet(), CORS, ValidationPipe global, listen()

  auth/                  ← POST /auth/login, POST /auth/register
    auth.controller.ts
    auth.service.ts      ← validateUser, login, register (bcrypt)
    jwt.strategy.ts      ← valida JWT, verifica is_registered, strip password_hash
    dto/login.dto.ts | register.dto.ts

  charges/               ← CRUD + bulk actions + recurring charges
    charges.controller.ts ← @UseGuards(AuthGuard('jwt')) na classe inteira
    charges.service.ts    ← IDOR check, plan limits, shadow user, auditoria
    dto/create-charge.dto.ts | update-charge-status.dto.ts | update-recurring-charge.dto.ts

  clients/               ← GET/POST/PATCH /clients
    clients.controller.ts ← @UseGuards(AuthGuard('jwt'), PlanGuard) + @RequiresModule('CLIENTS')
    clients.service.ts    ← CRUD de Client (credor↔devedor) com IDOR check
    dto/create-client.dto.ts | update-client.dto.ts

  profiles/              ← GET/PATCH /profiles (CreditorProfile, PIX, logo)
    profiles.controller.ts ← @UseGuards(AuthGuard('jwt'))
    profiles.service.ts    ← upsert CreditorProfile, audita PIX_CONFIG_UPDATED

  reports/               ← GET /reports
    reports.controller.ts
    reports.service.ts

  automation/            ← CRON jobs para cobranças recorrentes e lembretes WhatsApp
    automation.service.ts ← @Cron schedules: recurring charge generation, sendAutomatedReminders

  dashboard/             ← GET /dashboard (métricas, gráficos)
    dashboard.service.ts ← Promise.all paralelo, sem N+1

  subscription/          ← GET /subscription/status, POST /subscription/checkout, POST /webhooks/asaas
    subscription.service.ts ← getUserPlan, activatePlan, downgradeToFree

  whatsapp/              ← ÚNICO ponto de integração Z-API
    whatsapp.service.ts  ← send text, image, PIX button; nunca chamar Z-API fora daqui

  demo/                  ← Endpoint público (sem AuthGuard) para demo da landing page
    demo.controller.ts   ← POST /demo/send (rate limit por hash SHA-256 do IP)
    demo.service.ts      ← verifica DemoAttempt (máx por IP), persiste tentativa

  users/
    users.controller.ts  ← GET/PATCH/DELETE /users/me (perfil, senha, exclusão LGPD)
    users.service.ts     ← findByEmail, findByPhone, findById, registerUser (shadow user)
                            getProfile, updateProfile, updatePassword, deleteAccount

  prisma/
    prisma.service.ts    ← extends PrismaClient, onModuleInit
```

## Bootstrap (main.ts)

```ts
app.use(helmet());
app.enableCors({ origin: ['http://localhost:3000', 'http://localhost:3001'], credentials: true });
app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
```

## AuthGuard — Uso Obrigatório

```ts
@Controller('charges')
@UseGuards(AuthGuard('jwt'))  // aplica em TODOS os métodos da classe
export class ChargesController { ... }
```

## JWT Strategy

```ts
async validate(payload) {
  const user = await this.usersService.findById(payload.sub);
  if (!user || !user.is_registered) throw new UnauthorizedException();
  const { password_hash, ...secureUser } = user;
  return secureUser;  // disponível como req.user
}
```

## Padrão de Controller

```ts
@Get()
async findAll(@Request() req) {
  return this.service.findAll(req.user.id);  // sempre passa userId do JWT
}
```

## IDOR — Padrão Obrigatório em Services

```ts
// Opção 1: where composto (listagens)
this.prisma.charge.findMany({ where: { creditor_id: userId } });

// Opção 2: check manual (por ID)
const charge = await this.prisma.charge.findUnique({ where: { id: chargeId } });
if (!charge || charge.creditor_id !== userId) throw new ForbiddenException();
// Retorna ForbiddenException (não 404) — internamente usa findUnique sem expor existência
```

## Auditoria — Ações Obrigatórias

```ts
await this.prisma.auditLog.create({
  data: {
    user_id: userId,
    action: 'CHARGE_CREATED',  // SNAKE_UPPER_CASE
    entity: 'Charge',
    entity_id: charge.id,
    details: { ... },          // NUNCA incluir senhas, tokens, cartões
  }
});
```

Actions auditadas: `CHARGE_CREATED`, `CHARGE_CANCELED`, `CHARGE_BULK_CANCELED`, `PIX_CONFIG_UPDATED`, `PROFILE_UPDATED`, `SUBSCRIPTION_ACTIVATED`, `SUBSCRIPTION_DOWNGRADED`, `USER_REGISTERED_NEW`, `USER_REGISTERED_FROM_SHADOW`, `PASSWORD_CHANGED`, `ACCOUNT_DELETED`

## Rate Limiting (AppModule)

```ts
ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }])  // 100 req/min global
// APP_GUARD: ThrottlerGuard
```

## Testes — Regra Inegociável

Cada `*.service.ts`, `*.controller.ts`, `*.guard.ts` → arquivo `*.spec.ts` correspondente.

Cenários obrigatórios: happy path, sem assinatura (FREE), assinatura CANCELED/PAST_DUE, acesso negado a módulo premium.

Mock obrigatório: PrismaService, JwtService, APIs externas (Z-API, Asaas).

## Anti-patterns

- Nunca expor stack trace em produção
- Nunca logar senhas, tokens JWT, chaves PIX, dados de cartão
- Nunca `$queryRaw` com concatenação de string — sempre template literal parametrizado
- Nunca fazer verificação de propriedade apenas no controller — sempre no service
