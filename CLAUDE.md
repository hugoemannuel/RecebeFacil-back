# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start development server (watch mode)
npm run build        # Compile TypeScript to dist/
npm run lint         # ESLint with auto-fix
npm run test         # Run unit tests
npm run test:watch   # Jest with file watching
npm run test:cov     # Jest with coverage
npm run test:e2e     # End-to-end tests
npm run seed         # Run Prisma seed script
```

Database (Docker):
```bash
docker-compose up -d   # Start PostgreSQL 15 on port 5432
npx prisma migrate dev # Run migrations
npx prisma studio      # Open Prisma Studio
```

## Architecture

NestJS 11 monolith with PostgreSQL (Prisma ORM). Each domain is a standalone module; business logic lives in `*.service.ts`, controllers only delegate.

**Module layout:**

```
src/
├─ app.module.ts         ← Root: ThrottlerModule (100 req/min) + global guards
├─ auth/                 ← POST /auth/register, /auth/login (JWT + bcrypt)
├─ users/                ← UserService (shadow user promotion logic)
├─ charges/              ← /charges CRUD, bulk operations
├─ subscription/         ← /subscription/status
├─ dashboard/            ← /dashboard/metrics
├─ common/               ← PlanGuard, @RequiresModule, PLAN_MODULES, plan limits
└─ prisma/               ← PrismaService singleton
```

**Specialized skills** — invoke before working on any backend task:
- `/backend-expert` — Senior-level guidance on any backend task
- `/backend-architecture` — Module creation, AuthGuard, standard patterns
- `/backend-prisma` — Schema rules, migrations, upserts, Shadow User
- `/backend-security` — IDOR, user enumeration, what to never log
- `/backend-plan-guard` — PlanGuard, PLAN_MODULES, charge limits
- `/backend-integrations` — Z-API (WhatsApp) and Asaas (payment gateway)

## Key Patterns

**Authentication:** `@UseGuards(AuthGuard('jwt'))` is applied at the **controller class level**. The JWT strategy validates `is_registered: true` (rejects shadow users) and strips `password_hash` before injecting into `req.user`.

**Plan gating:** `@RequiresModule('MODULE_NAME')` + `PlanGuard` checks `Subscription.plan_type` + `status`. If status is not `ACTIVE`, user is treated as FREE. Plan limits are defined in `src/common/plan-modules.ts`.

**IDOR prevention:**
- List queries: always `where: { creditor_id: userId }` 
- Single-entity: fetch → compare `creditor_id === userId` → throw `ForbiddenException` (never 404)

**Shadow User:** Debtors are created with `is_registered: false` when a charge is first created for their phone number. They become real users via `POST /auth/register`.

## Prisma Schema

Core tables: `User`, `CreditorProfile`, `IntegrationConfig`, `Subscription`, `Charge`, `RecurringCharge`, `MessageTemplate`, `MessageHistory`, `AuditLog`.

- Monetary values: always `Int` in **centavos** (R$ 1,00 = 100)
- `User` stores identity/auth only; business data goes in `CreditorProfile`
- `IntegrationConfig` stores per-creditor Z-API and Asaas credentials

## Integrations

**Asaas (payment gateway):**
- Webhook validation: header `asaas-access-token` must match `ASAAS_WEBHOOK_SECRET`
- Idempotency: store `asaas_payment_id` on `Subscription` to prevent duplicate processing
- `PAYMENT_CONFIRMED` → activate plan; `PAYMENT_OVERDUE` / `PAYMENT_DELETED` → downgrade to FREE

**Z-API (WhatsApp):**
- Credentials stored per-instance in `IntegrationConfig` (not env vars)
- Throttle 1–2 s between bulk sends to prevent number ban
- Opt-out: debtor replies "PARAR" → set `allows_automation = false`
- Track `zapi_message_id` in `MessageHistory` for delivery proof

## Plan Limits

| Plan | Monthly charges | Recurrences | Bulk actions | Custom templates |
|------|----------------|-------------|--------------|-----------------|
| FREE | 10 | ONCE | ✗ | 0 |
| STARTER | 50 | ONCE, WEEKLY | ✗ | 3 |
| PRO | 200 | All | ✓ | unlimited |
| UNLIMITED | 999,999 | All | ✓ | unlimited |

## Security Rules

- `ValidationPipe` is global with `whitelist: true, forbidNonWhitelisted: true`
- bcrypt with **12 rounds** minimum
- Never log: passwords, JWT tokens, `ASAAS_API_KEY`, Z-API tokens, PIX keys, card data
- User enumeration: always return a generic error on register failure — never expose "email already registered"
- Audit every important action via `AuditLog`

## Environment

Copy `.env.example` to `.env`. Required variables:

```
DATABASE_URL       # PostgreSQL connection string
JWT_SECRET         # JWT signing key
ASAAS_API_KEY      # Asaas payment gateway
ASAAS_WEBHOOK_SECRET
FRONTEND_URL       # CORS origin whitelist
PORT               # Default 3001
```
