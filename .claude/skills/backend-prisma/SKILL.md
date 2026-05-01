---
name: backend-prisma
description: Regras do schema Prisma do RecebeFácil — normalização de tabelas, Shadow User, enums, valores monetários e padrões de query. Use ao criar migrations, models ou queries Prisma.
when_to_use: Quando criar ou alterar models Prisma, escrever queries, criar migrations, trabalhar com Shadow User ou definir onde guardar um novo campo.
---

## Regra de Ouro: Normalização Obrigatória

**`User` contém APENAS dados de identidade e autenticação.**

| Tipo de dado                         | Tabela correta       |
|--------------------------------------|----------------------|
| Identidade/Auth (phone, email, senha)| `User`               |
| Dados comerciais (PIX, nome empresa) | `CreditorProfile`    |
| Credenciais de APIs externas (Z-API, Asaas) | `IntegrationConfig` |
| Templates de mensagem WhatsApp       | `MessageTemplate`    |
| Assinatura/Plano                     | `Subscription`       |

Qualquer novo campo → definir a tabela correta antes de criar.

## Model User (imutável — não adicionar campos de negócio)

```prisma
model User {
  id            String  @id @default(uuid())
  phone         String  @unique  // DDI+DDD+Num: "5511999999999" (E.164)
  name          String
  email         String? @unique
  password_hash String?
  is_registered Boolean @default(false)  // false = Shadow User
}
```

## Shadow User

```ts
// Ao criar cobrança para número desconhecido:
let debtor = await this.prisma.user.findUnique({ where: { phone: dto.debtor_phone } });

if (!debtor) {
  debtor = await this.prisma.user.create({
    data: { phone: dto.debtor_phone, name: dto.debtor_name, is_registered: false },
  });
}
// Ao se registrar depois: is_registered = true, dados preenchidos
```

## Ativação de Shadow User no Registro

```ts
const shadowUser = existingEmail || existingPhone;
if (shadowUser) {
  user = await this.prisma.user.update({
    where: { id: shadowUser.id },
    data: { name, email, phone, password_hash, is_registered: true },
  });
  // Registrar auditoria USER_REGISTERED_FROM_SHADOW
}
```

## Valores Monetários

- Sempre `Int` em **centavos** (nunca `Float`)
- `R$ 150,00 = 15000`
- Front-end converte com `parseMoney()` / `formatMoney()`

## Enums

```prisma
enum PlanType       { FREE STARTER PRO UNLIMITED }
enum SubStatus      { ACTIVE CANCELED PAST_DUE }
enum SubPeriod      { MONTHLY YEARLY }
enum SubModule      { HOME CHARGES CLIENTS REPORTS EXCEL_IMPORT }
enum ChargeStatus   { PENDING PAID OVERDUE CANCELED }
enum TriggerType    { MANUAL AUTO_REMINDER_BEFORE AUTO_REMINDER_DUE AUTO_REMINDER_OVERDUE }
enum Frequency      { WEEKLY MONTHLY YEARLY }
enum PixKeyType     { CPF CNPJ PHONE EMAIL EVP }
enum MessageTrigger { MANUAL BEFORE_DUE ON_DUE OVERDUE }
```

## Novos Modelos

```prisma
// Relacionamento credor ↔ devedor com notas
model Client {
  creditor_id String
  debtor_id   String
  notes       String?
  @@unique([creditor_id, debtor_id])
}

// Definição de cobrança recorrente
model RecurringCharge {
  id           String    @id @default(uuid())
  creditor_id  String
  frequency    Frequency
  amount       Int       // centavos
  start_date   DateTime
  end_date     DateTime?
  // RelRelação many-to-many via RecurringChargeDebtor
}

// Many-to-many: recorrente ↔ devedor
model RecurringChargeDebtor {
  recurring_charge_id String
  debtor_id           String
  @@unique([recurring_charge_id, debtor_id])
}

// Rate limit da demo pública (hash SHA-256 do IP)
model DemoAttempt {
  id         String   @id @default(uuid())
  ip_hash    String
  created_at DateTime @default(now())
}
```

## Campos Críticos de Segurança

```prisma
model IntegrationConfig {
  allows_automation   Boolean @default(true)  // Opt-out: devedor enviou "PARAR"
  asaas_account_key   String? // CRIPTOGRAFAR em repouso (AES-256) — feature futura
}

model MessageHistory {
  error_details String?  // NUNCA expor na API — apenas logs internos
}

model Subscription {
  asaas_payment_id String?  // Para idempotência de webhooks
}
```

## Upsert Pattern

```ts
// Usar quando criar ou atualizar dependendo de existência:
await this.prisma.creditorProfile.upsert({
  where: { user_id: userId },
  update: { pix_key, pix_key_type },
  create: { user_id: userId, pix_key, pix_key_type },
});
```

## Prevenção de User Enumeration no Registro

```ts
// NUNCA: "E-mail já cadastrado"
throw new ConflictException('Não foi possível realizar o cadastro. Verifique os dados informados.');
// Log real apenas internamente:
console.error(`[Auth] E-mail já em uso: ${dto.email}`);
```

## Promise.all Paralelo (Dashboard)

```ts
const [summary, topClients, chart] = await Promise.all([
  this.getSummaryMetrics(userId, ...),
  this.getTopClients(userId, ...),
  this.getChartData(userId, ...),
]);
```

## Anti-patterns

- Nunca adicionar `asaas_customer_id`, `pix_key`, `zapi_token` na tabela `User`
- Nunca usar `Float` para valores monetários — sempre `Int` (centavos)
- Nunca retornar `password_hash` em nenhum endpoint
- Nunca usar `$queryRaw` com concatenação de string
