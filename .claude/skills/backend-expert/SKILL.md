---
name: backend-expert
description: Especialista sênior em back-end do RecebeFácil. Conhece toda a arquitetura NestJS, schema Prisma, regras de domínio, segurança, plan gating, CRON jobs e integrações Z-API/Asaas. Invocar para qualquer tarefa de back-end.
when_to_use: Qualquer tarefa de back-end — criar endpoint, service, DTO, guard, migration Prisma, CRON job, webhook, integração Z-API ou Asaas, regra de negócio de plano ou decisão arquitetural.
---

## Arquitetura

**Stack:** NestJS · Prisma ORM · PostgreSQL (Docker) · JWT (passport-jwt) · bcrypt · class-validator · @nestjs/throttler · Jest

**Estrutura de módulos:**
```
src/
  app.module.ts         ← Root: ThrottlerModule global + ThrottlerGuard como APP_GUARD
  main.ts               ← helmet(), CORS, ValidationPipe global, listen()

  auth/                 ← POST /auth/login, POST /auth/register
    auth.service.ts     ← validateUser (bcrypt), login (JWT), register (shadow user)
    jwt.strategy.ts     ← valida JWT, verifica is_registered, strip password_hash → req.user
    dto/login.dto.ts | register.dto.ts

  charges/              ← CRUD + bulk actions
    charges.controller.ts ← @UseGuards(AuthGuard('jwt')) na classe
    charges.service.ts    ← plan limit, recurrence check, shadow user, auditoria, IDOR
    dto/create-charge.dto.ts

  common/
    plan.guard.ts                ← PlanGuard (CanActivate): consulta Subscription, valida módulo
    plan-modules.ts              ← PLAN_MODULES, TEMPLATE_LIMITS, canAccessModule()
    requires-module.decorator.ts ← @RequiresModule('CLIENTS')

  dashboard/
    dashboard.service.ts  ← Promise.all paralelo para métricas, sem N+1

  subscription/
    subscription.service.ts  ← getUserPlan, activatePlan (upsert), downgradeToFree
    subscription.controller.ts ← GET /subscription/status, POST /subscription/checkout, POST /webhooks/asaas

  whatsapp/
    whatsapp.service.ts  ← ÚNICO ponto de integração Z-API (envio de texto, imagem, botão PIX)

  demo/
    demo.controller.ts   ← POST /demo/send (endpoint público, sem AuthGuard, para landing page)

  users/
    users.service.ts  ← findByEmail, findByPhone, findById, registerUser (shadow user logic)

  prisma/
    prisma.service.ts ← extends PrismaClient, onModuleInit
```

---

## Bootstrap (main.ts)

```ts
app.use(helmet());
app.enableCors({ origin: ['http://localhost:3000', 'http://localhost:3001'], credentials: true });
app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
```

`whitelist + forbidNonWhitelisted` bloqueia Mass Assignment — campos não declarados no DTO são rejeitados.

---

## Regras de Domínio

### Shadow User
Todo número de telefone que recebe uma cobrança vira um `User` com `is_registered: false`. Ao se cadastrar, o shadow user é promovido (update, não create).

```ts
// Criar cobrança — encontrar ou criar devedor:
let debtor = await this.prisma.user.findUnique({ where: { phone: dto.debtor_phone } });
if (!debtor) debtor = await this.prisma.user.create({ data: { phone: dto.debtor_phone, name: dto.debtor_name, is_registered: false } });

// Registro — promover shadow user:
const shadow = existingEmail || existingPhone;
if (shadow) {
  user = await this.prisma.user.update({ where: { id: shadow.id }, data: { name, email, phone, password_hash, is_registered: true } });
  // Auditar: USER_REGISTERED_FROM_SHADOW
}
```

### Normalização de Tabelas (regra inegociável)
`User` contém **apenas** identidade/auth. Dados de negócio em tabelas separadas:

| Dado | Tabela |
|---|---|
| phone, email, password_hash, is_registered | `User` |
| pix_key, business_name, message_templates | `CreditorProfile` |
| zapi_instance_id, asaas_customer_id, allows_automation | `IntegrationConfig` |
| Templates de mensagem WhatsApp | `MessageTemplate` |
| Plano, período, status | `Subscription` |

### Valores Monetários
Sempre `Int` em **centavos**. Nunca `Float`. `R$ 150,00 = 15000`.

### Prevenção de User Enumeration
```ts
// NUNCA: "E-mail já cadastrado"
throw new ConflictException('Não foi possível realizar o cadastro. Verifique os dados informados.');
console.error(`[Auth] E-mail já em uso: ${dto.email}`); // log interno apenas
```

---

## Prisma — Padrões

**Enums:**
```prisma
PlanType      { FREE STARTER PRO UNLIMITED }
SubStatus     { ACTIVE CANCELED PAST_DUE }
ChargeStatus  { PENDING PAID OVERDUE CANCELED }
TriggerType   { MANUAL AUTO_REMINDER_BEFORE AUTO_REMINDER_DUE AUTO_REMINDER_OVERDUE }
PixKeyType    { CPF CNPJ PHONE EMAIL EVP }
MessageTrigger { MANUAL BEFORE_DUE ON_DUE OVERDUE }
```

**Upsert pattern:**
```ts
await this.prisma.creditorProfile.upsert({
  where: { user_id: userId },
  update: { pix_key, pix_key_type },
  create: { user_id: userId, pix_key, pix_key_type },
});
```

**Promise.all para queries paralelas (dashboard):**
```ts
const [summary, topClients, chart, recentActivity] = await Promise.all([
  this.getSummaryMetrics(...), this.getTopClients(...),
  this.getChartData(...),     this.getRecentActivity(...),
]);
```

---

## Segurança

### IDOR — Padrão Obrigatório
```ts
// Where composto (listagens):
this.prisma.charge.findMany({ where: { creditor_id: userId } });

// Check manual (por ID):
const charge = await this.prisma.charge.findUnique({ where: { id: chargeId } });
if (!charge || charge.creditor_id !== userId) throw new ForbiddenException();
// Usar ForbiddenException, não NotFoundException — não revelar existência
```

### Autenticação
```ts
// jwt.strategy.ts
async validate(payload) {
  const user = await this.usersService.findById(payload.sub);
  if (!user || !user.is_registered) throw new UnauthorizedException();
  const { password_hash, ...secureUser } = user;
  return secureUser; // req.user
}

// Controller — AuthGuard na classe inteira:
@Controller('charges')
@UseGuards(AuthGuard('jwt'))
export class ChargesController { }
```

### Senhas
```ts
const hash = await bcrypt.hash(dto.password, 12);   // mínimo 10 rounds
const ok   = await bcrypt.compare(pass, user.password_hash);
```

### ValidationPipe (DTOs)
```ts
export class CreateChargeDto {
  @IsString() @IsNotEmpty() debtor_name: string;
  @IsNumber() @Min(100)     amount: number;        // centavos
  @IsString() @MaxLength(200) description: string;
  @IsEnum(['ONCE','WEEKLY','MONTHLY','YEARLY']) recurrence: string;
  @IsOptional() @IsEnum(['CPF','CNPJ','PHONE','EMAIL','EVP']) pix_key_type?: string;
}
```

### Rate Limiting
```ts
// Global: 100 req/min (AppModule)
ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }])
// Rotas críticas com decorator adicional:
@Throttle({ default: { ttl: 900000, limit: 5 } })  // 5/15min para /auth/login
```

### Variáveis de Ambiente Críticas
```env
JWT_SECRET=           # OBRIGATÓRIO em produção
ASAAS_API_KEY=        # Nunca no código-fonte
ASAAS_WEBHOOK_SECRET= # Validar webhooks
ZAPI_INSTANCE_ID=     ZAPI_INSTANCE_TOKEN=     ZAPI_CLIENT_TOKEN=
```

### O que NUNCA logar
Senhas · tokens JWT · ASAAS_API_KEY · ZAPI tokens · chaves PIX · dados de cartão · `error_details` de MessageHistory

---

## Plan Gating

**Fonte da verdade (`common/plan-modules.ts`):**
```ts
export const PLAN_MODULES: Record<PlanType, string[]> = {
  FREE:      ['HOME', 'CHARGES'],
  STARTER:   ['HOME', 'CHARGES', 'CLIENTS', 'REPORTS', 'EXCEL_IMPORT', 'CUSTOM_TEMPLATES'],
  PRO:       ['HOME', 'CHARGES', 'CLIENTS', 'REPORTS', 'EXCEL_IMPORT', 'CUSTOM_TEMPLATES'],
  UNLIMITED: ['HOME', 'CHARGES', 'CLIENTS', 'REPORTS', 'EXCEL_IMPORT', 'CUSTOM_TEMPLATES'],
};
export const canAccessModule = (plan: PlanType, module: string) => PLAN_MODULES[plan]?.includes(module) ?? false;
```

**PlanGuard — lógica:**
```ts
// PAST_DUE / CANCELED / sem assinatura → trata como FREE
const effectivePlan = subscription?.status === 'ACTIVE' ? subscription.plan_type : PlanType.FREE;
if (!canAccessModule(effectivePlan, requiredModule)) throw new ForbiddenException('...');
request.userPlan = effectivePlan; // disponível no controller
```

**Uso no controller:**
```ts
@Controller('clients')
@UseGuards(AuthGuard('jwt'), PlanGuard)
export class ClientsController {
  @Get() @RequiresModule('CLIENTS')
  async list(@Request() req) { ... }
}
```

**Limites de cobranças (ChargesService):**
```ts
const limits = { FREE: 10, STARTER: 50, PRO: 200, UNLIMITED: 999999 };
const count = await this.prisma.charge.count({ where: { creditor_id: userId, created_at: { gte: startOfMonth } } });
if (count >= limits[plan]) throw new ForbiddenException('LIMIT_REACHED');
```

**Recorrências por plano:**
```ts
const allowed = { FREE: ['ONCE'], STARTER: ['ONCE','WEEKLY'], PRO: ['ONCE','WEEKLY','MONTHLY','YEARLY'], UNLIMITED: ['ONCE','WEEKLY','MONTHLY','YEARLY'] };
if (!allowed[plan]?.includes(dto.recurrence)) throw new ForbiddenException('RECURRENCE_NOT_ALLOWED');
```

**Bulk actions (service):**
```ts
if (['FREE','STARTER'].includes(subscription.plan_type)) throw new ForbiddenException('Requer plano PRO.');
```

---

## Auditoria

Ações críticas sempre criam `AuditLog`:
```ts
await this.prisma.auditLog.create({
  data: { user_id: userId, action: 'CHARGE_CREATED', entity: 'Charge', entity_id: charge.id, details: { ... } }
  // details: NUNCA incluir senhas, tokens, dados de cartão
});
```

Actions: `CHARGE_CREATED` · `CHARGE_CANCELED` · `CHARGE_BULK_CANCELED` · `PIX_CONFIG_UPDATED` · `SUBSCRIPTION_ACTIVATED` · `SUBSCRIPTION_DOWNGRADED` · `USER_REGISTERED_NEW` · `USER_REGISTERED_FROM_SHADOW`

---

## CRON Jobs

```ts
// Transição PENDING → OVERDUE (meia-noite)
@Cron('0 0 0 * * *')
async markOverdueCharges() {
  await this.prisma.charge.updateMany({
    where: { status: 'PENDING', due_date: { lt: new Date() } },
    data: { status: 'OVERDUE' },
  });
}

// Automação WhatsApp — STARTER/PRO (08h)
@Cron(CronExpression.EVERY_DAY_AT_8AM)
async sendAutomatedReminders() { /* busca PENDING/OVERDUE de planos ativos */ }
```

---

## Z-API (WhatsApp)

**Único ponto de integração:** `WhatsAppService`. Nenhum controller chama Z-API diretamente.

**Endpoints:**
```ts
POST /send-text       { phone, message }                                    // *negrito*, _itálico_, emojis
POST /send-image      { phone, image: 'base64|URL', caption }
POST /send-button-pix { phone, pixKey, type: 'CPF|CNPJ|PHONE|EMAIL|EVP', merchantName } // máx 25 chars
```

**Ordem de envio:** 1) texto → 2) QR Code (se `pix_qr_code_url`) → 3) botão PIX (se `pix_key`)

**Após envio:**
```ts
await this.prisma.messageHistory.create({
  data: { charge_id, trigger_type: 'MANUAL', status: 'SENT', zapi_message_id: response.id,
          error_details: null /* se FAILED: logar internamente, nunca expor */ }
});
```

**Throttle em massa:** aguardar 1-2s entre mensagens para evitar banimento do número.

**Opt-out devedor:** se responder "PARAR" → `allows_automation = false` em `IntegrationConfig`. Verificar antes de qualquer automação.

---

## Asaas (Gateway de Pagamento)

**Fluxo de checkout:**
```
POST /subscription/checkout { planType, period }
  → Verificar asaas_customer_id em IntegrationConfig
  → POST /customers no Asaas (se não tiver) → salvar asaas_customer_id
  → POST /payments { customer, value, dueDate, billingType: 'UNDEFINED' }
  → Retornar { invoiceUrl } → front-end redireciona
```

**Webhook — validação obrigatória:**
```ts
@Post('/webhooks/asaas')
async handleWebhook(@Headers('asaas-access-token') token: string, @Req() req) {
  if (token !== process.env.ASAAS_WEBHOOK_SECRET) throw new UnauthorizedException();
  await this.subscriptionService.handleWebhookEvent(req.body);
}
```

**Idempotência — upsert para evitar duplicação:**
```ts
await this.prisma.subscription.upsert({
  where: { user_id: userId },
  update: { plan_type, status: 'ACTIVE', asaas_payment_id },
  create: { user_id: userId, plan_type, status: 'ACTIVE', period, current_period_start: now, current_period_end, asaas_payment_id },
});
```

**Eventos:**
```ts
'PAYMENT_CONFIRMED' → activatePlan()     → status = 'ACTIVE'
'PAYMENT_OVERDUE'   → status = 'PAST_DUE'
'PAYMENT_DELETED' | 'PAYMENT_REFUNDED' → downgradeToFree()
```

---

## Testes (TDD — regra inegociável)

Todo `*.service.ts`, `*.controller.ts`, `*.guard.ts` → arquivo `*.spec.ts` correspondente.

**Cenários obrigatórios:** happy path · sem assinatura (FREE) · CANCELED/PAST_DUE → FREE · acesso negado a módulo premium · idempotência (mesma ação duas vezes não duplica).

**Mocks obrigatórios:** PrismaService · JwtService · Z-API · Asaas.

---

## Anti-patterns

- Nunca campo de negócio (pix_key, asaas_id, zapi_token) na tabela `User`
- Nunca `Float` para valores monetários — sempre `Int` (centavos)
- Nunca retornar `password_hash` em nenhum endpoint
- Nunca verificar plano inline no controller — PlanGuard ou service
- Nunca duplicar PLAN_MODULES — importar de `common/plan-modules.ts`
- Nunca `$queryRaw` com concatenação de string — template literal parametrizado
- Nunca processar webhook sem validar assinatura
- Nunca processar mesmo webhook duas vezes — `asaas_payment_id` como idempotência
- Nunca armazenar dados de cartão (PCI DSS — todo processamento via Asaas)
- Nunca expor stack trace em produção (`NODE_ENV=production`)
- Nunca chamar Z-API fora do `WhatsAppService`
- Nunca enviar mensagens agressivas — risco de banimento do número WhatsApp
- Nunca subir funcionalidade sem testes (`*.spec.ts` correspondente)
