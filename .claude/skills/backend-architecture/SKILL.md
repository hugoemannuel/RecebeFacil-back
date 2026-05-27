---
name: backend-architecture
description: Arquitetura NestJS do RecebeF��cil — módulos, controllers, services, guards e padrões de código. Use ao criar qualquer arquivo no back-end.
when_to_use: Quando criar controllers, services, modules, DTOs, guards ou qualquer novo arquivo no back-end NestJS.
---

## Guards Globais (APP_GUARD)

`JwtAuthGuard` e `ThrottlerGuard` são registrados como `APP_GUARD` no `AppModule` — aplicam em **todas** as rotas automaticamente.

```ts
// app.module.ts
providers: [
  { provide: APP_GUARD, useClass: ThrottlerGuard },  // 100 req/min
  { provide: APP_GUARD, useClass: JwtAuthGuard },    // JWT obrigatório
]
```

**Nunca usar `@UseGuards(AuthGuard('jwt'))` nos controllers** — o guard já é global.

Para rotas públicas, usar o decorator `@Public()`:

```ts
@Post('webhook')
@Public()  // desativa JwtAuthGuard para esta rota
async handleWebhook() { ... }
```

`PlanGuard` **não** é global — declarar explicitamente com `@UseGuards(PlanGuard)` quando necessário.

## Bootstrap (main.ts)

```ts
// Validações de segurança no boot
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('[SEGURANÇA] JWT_SECRET é obrigatório em produção.');
}
if (!process.env.DATABASE_URL) {
  throw new Error('[CONFIG] DATABASE_URL não está definida.');
}

app.useBodyParser('json', { limit: '1mb' });
app.use(helmet({ crossOriginResourcePolicy: false }));

// CORS usa env var — não hardcoded
const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(',').map(url => url.trim())
  : ['http://localhost:3000'];
app.enableCors({ origin: allowedOrigins, credentials: true });

app.useGlobalPipes(new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
}));
```

## Estrutura de Módulos (16 módulos)

```
src/
├── app.module.ts          ← Raiz: APP_GUARD (Throttler + JWT), ScheduleModule
├── main.ts                ← Bootstrap: helmet, CORS via FRONTEND_URL, ValidationPipe
├── auth/                  ← POST /auth/login, /auth/register; JWT strategy
├── users/                 ← GET/PATCH/DELETE /users/me; LGPD (anonimização)
├── charges/               ← CRUD cobranças, recorrências, bulk, notify
├── clients/               ← GET/POST/PATCH /clients (vínculo credor↔devedor)
├── profiles/              ← GET/PATCH /profiles (CreditorProfile, PIX, logo)
├── subscription/          ← Planos, checkout, faturas, sync com Asaas
├── integrations/          ← Asaas API, saques, split, webhook controller + worker
├── automation/            ← CRON: recorrências (meia-noite) + lembretes (horário)
├── dashboard/             ← GET /dashboard/metrics (Promise.all paralelo)
├── reports/               ← GET /reports (stub — não implementado)
├── whatsapp/              ← WhatsAppService (único ponto Z-API)
├── queue/                 ← PgBossService (pg-boss)
├── webhooks/              ← ZapiWebhookModule (mensagens entrantes Z-API)
├── demo/                  ← POST /demo/send (público, rate limit por IP hash)
└── prisma/                ← PrismaService singleton (global)
```

## Padrão de Módulo

```
src/nome-modulo/
├── nome-modulo.module.ts         ← Declaração NestJS
├── nome-modulo.controller.ts     ← Rotas, extração de userId, guards
├── nome-modulo.service.ts        ← Toda lógica de negócio
├── dto/
│   ├── create-nome.dto.ts
│   └── update-nome.dto.ts
└── spec/
    └── nome-modulo.service.spec.ts  ← Obrigatório para services com lógica
```

## Padrão de Controller (sem lógica de negócio)

```ts
@Controller('charges')
export class ChargesController {
  constructor(private readonly chargesService: ChargesService) {}

  @Get()
  @UseGuards(PlanGuard)
  @RequiresModule('CHARGES')
  findAll(@Req() req: Request) {
    return this.chargesService.findAll(req.user.id);  // sempre userId do JWT
  }

  @Post()
  @UseGuards(PlanGuard)
  @RequiresModule('CHARGES')
  create(@Req() req: Request, @Body() dto: CreateChargeDto) {
    return this.chargesService.createCharge(req.user.id, dto);
  }
}
```

## JWT Strategy (src/auth/jwt.strategy.ts)

```ts
async validate(payload: { sub: string }) {
  const user = await this.usersService.findById(payload.sub);
  if (!user || !user.is_registered) throw new UnauthorizedException();
  const { password_hash, ...secureUser } = user;
  return secureUser;  // disponível como req.user
}
```

Shadow Users (`is_registered: false`) são **rejeitados automaticamente** pela strategy.

## IDOR — Padrão Obrigatório nos Services

```ts
// Listagens: WHERE creditor_id = userId
const charges = await this.prisma.charge.findMany({
  where: { creditor_id: userId },
});

// Por ID: fetch → validar → 403 (nunca 404)
const charge = await this.prisma.charge.findUnique({ where: { id } });
if (!charge) throw new ForbiddenException();
if (charge.creditor_id !== userId) throw new ForbiddenException();
```

## Auditoria — Ações Críticas

```ts
await this.prisma.auditLog.create({
  data: {
    user_id: userId,
    action: 'WITHDRAWAL_REQUESTED',  // SNAKE_UPPER_CASE
    entity: 'WithdrawalRecord',
    entity_id: record.id,
    details: { value, pix_key_type },  // NUNCA incluir: senhas, tokens, chave PIX completa
    ip_address: req.ip,
  }
});
```

## Rate Limiting por Rota

```ts
// Global: 100 req/min (AppModule)
// Por rota:
@Throttle({ default: { ttl: 900000, limit: 5 } })   // 5/15min → /auth/login
@Throttle({ default: { ttl: 3600000, limit: 10 } })  // 10/1h  → /auth/register
@Throttle({ default: { ttl: 60000, limit: 1 } })     // 1/min  → /finance/withdraw
@Throttle({ default: { ttl: 300000, limit: 2 } })    // 2/5min → /subscription/retry-payment
```

## Anti-patterns

- Nunca `@UseGuards(AuthGuard('jwt'))` nos controllers — guard já é global via APP_GUARD
- Nunca lógica de negócio no controller — apenas delegação ao service
- Nunca hardcodar origem CORS — usar `FRONTEND_URL` env var
- Nunca verificar propriedade de recurso no controller — sempre no service
- Nunca criar módulo sem arquivo `*.service.spec.ts` se o service tem lógica real
- Nunca expor `password_hash` em nenhum endpoint
