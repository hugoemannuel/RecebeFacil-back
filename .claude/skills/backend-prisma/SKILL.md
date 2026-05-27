---
name: backend-prisma
description: Regras do schema Prisma do RecebeFácil — normalização de tabelas, Shadow User, enums, valores monetários e padrões de query. Use ao criar migrations, models ou queries Prisma.
when_to_use: Quando criar ou alterar models Prisma, escrever queries, criar migrations, trabalhar com Shadow User ou definir onde guardar um novo campo.
---

## Regra de Ouro: Normalização Obrigatória

**`User` contém APENAS identidade e autenticação.**

| Tipo de dado | Tabela correta |
|---|---|
| phone, email, password_hash, is_registered | `User` |
| business_name, pix_key, logo_url, templates | `CreditorProfile` |
| zapi_instance_id, asaas_customer_id, asaas_account_key, automation config | `IntegrationConfig` |
| plan_type, status, asaas_id | `Subscription` |
| Templates de mensagem WhatsApp | `MessageTemplate` |
| Saques PIX | `WithdrawalRecord` |
| Eventos de webhook (deduplicação) | `WebhookEvent` |
| Taxas e termos de split | `SplitTerm` |

## Enums Completos e Corretos

```prisma
enum PlanType        { FREE STARTER PRO UNLIMITED }
enum SubStatus       { ACTIVE INACTIVE PAUSED CANCELED OVERDUE PENDING }
enum SubPeriod       { MONTHLY YEARLY }
enum SubModule       { HOME CHARGES CLIENTS REPORTS EXCEL_IMPORT }
enum ChargeStatus    { PENDING PAID OVERDUE CANCELED }
enum TriggerType     { MANUAL AUTO_REMINDER_BEFORE AUTO_REMINDER_DUE AUTO_REMINDER_OVERDUE }
enum Frequency       { WEEKLY MONTHLY YEARLY }
enum PixKeyType      { CPF CNPJ PHONE EMAIL EVP }
enum MessageTrigger  { MANUAL BEFORE_DUE ON_DUE OVERDUE }
enum WithdrawalStatus { PENDING PROCESSING CONFIRMED FAILED REVERSED }
```

**Nunca usar `PAST_DUE`** — não existe no schema. O correto é `OVERDUE`.

## Valores Monetários

- Sempre `Int` em **centavos** (nunca `Float` ou `Decimal`)
- `R$ 150,00 = 15000`
- Exceção: `WithdrawalRecord.value` usa `Decimal(10,2)` (valor real de saque)
- `SplitTerm.platform_fee_pct` usa `Decimal` (porcentagem)

## Shadow User

```ts
// Criar devedor ao criar cobrança:
let debtor = await this.prisma.user.findUnique({ where: { phone: normalizePhone(dto.phone) } });

if (!debtor) {
  debtor = await this.prisma.user.create({
    data: { phone: normalizePhone(dto.phone), name: dto.name, is_registered: false },
  });
}

// Ao se registrar: promover shadow user (update, não create)
const shadow = await this.prisma.user.findFirst({
  where: { OR: [{ email: dto.email }, { phone: dto.phone }] }
});
if (shadow) {
  await this.prisma.user.update({
    where: { id: shadow.id },
    data: { name, email, phone, password_hash, is_registered: true },
  });
  // AuditLog: USER_REGISTERED_FROM_SHADOW
}
```

Shadow Users **não podem autenticar** (`JwtStrategy` rejeita `is_registered: false`).

## Modelos Críticos Novos

### WithdrawalRecord

```prisma
model WithdrawalRecord {
  id                String           @id @default(uuid())
  user_id           String
  idempotency_key   String           @unique  // UUID gerado no front-end
  value             Decimal          @db.Decimal(10, 2)
  pix_key_masked    String           // NUNCA armazenar chave completa
  pix_key_type      String
  status            WithdrawalStatus @default(PENDING)
  asaas_transfer_id String?
  failure_reason    String?
  processed_at      DateTime?
  confirmed_at      DateTime?
  failed_at         DateTime?
  user              User             @relation(fields: [user_id], references: [id], onDelete: Cascade)

  @@index([user_id, created_at])
  @@index([asaas_transfer_id])
}
```

### WebhookEvent

```prisma
model WebhookEvent {
  id             String    @id @default(uuid())
  source         String    // 'ASAAS' | 'ZAPI'
  event_type     String    // 'PAYMENT_CONFIRMED'
  asaas_event_id String?   @unique  // SHA-256(event:entityId) — deduplicação
  payload        Json
  processed      Boolean   @default(false)
  processed_at   DateTime?
  error          String?
  retry_count    Int       @default(0)

  @@index([source, event_type])
  @@index([processed, created_at])
}
```

### SplitTerm

```prisma
model SplitTerm {
  id               String   @id @default(uuid())
  version          String   @unique
  is_active        Boolean  @default(true)
  content          String   @db.Text
  platform_fee_pct Decimal  @default(1.0)
  asaas_pix_fee    String   @default("R$ 0,99")
  // ...
}
```

## Campos Críticos do Schema Atual

### IntegrationConfig (campos completos)

```prisma
model IntegrationConfig {
  zapi_instance_id     String?
  zapi_instance_token  String?
  allows_automation    Boolean @default(true)    // master switch
  automation_days_before Int   @default(2)
  automation_days_after  Int   @default(1)
  send_hour              Int   @default(9)       // BRT (0-23)
  allow_before_due     Boolean @default(true)
  allow_on_due         Boolean @default(true)
  allow_overdue        Boolean @default(true)
  asaas_customer_id    String?
  asaas_wallet_id      String?
  asaas_account_key    String?  // CRIPTOGRAFADO AES-256-GCM — nunca salvar em plain-text
  split_terms_accepted_at DateTime?
  split_terms_version  String?
}
```

### Charge (índice importante)

```prisma
model Charge {
  // ...
  is_intermediated Boolean  @default(false)
  asaas_payment_id String?  // indexed
  @@index([asaas_payment_id])  // lookup rápido no webhook
}
```

### DemoAttempt

```prisma
model DemoAttempt {
  id        String   @id @default(uuid())
  ipHash    String   @unique  // camelCase — SHA-256 do IP
  createdAt DateTime @default(now())  // camelCase
}
```

## Upsert Pattern

```ts
await this.prisma.creditorProfile.upsert({
  where: { user_id: userId },
  update: { pix_key, pix_key_type },
  create: { user_id: userId, pix_key, pix_key_type },
});
```

## Migrations

```bash
npx prisma migrate dev --name nome_da_mudanca  # dev
npx prisma migrate deploy                       # produção
npx prisma generate                             # gerar Prisma Client sem migration
```

## Anti-patterns

- Nunca adicionar campo de negócio (pix_key, asaas_id, zapi_token) na tabela `User`
- Nunca usar `Float` para valores monetários — sempre `Int` (centavos)
- Nunca salvar `asaas_account_key` sem criptografar com `CryptoService`
- Nunca salvar chave PIX completa — apenas `pix_key_masked`
- Nunca retornar `password_hash` em nenhum endpoint
- Nunca usar `PAST_DUE` — o enum correto é `OVERDUE`
- Nunca editar arquivo de migration já criado — criar nova migration
- Nunca usar `$queryRaw` com concatenação de string — template literal do Prisma
