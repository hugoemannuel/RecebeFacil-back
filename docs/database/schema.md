# Schema do Banco de Dados

**Arquivo:** `back-end/prisma/schema.prisma`  
**Provider:** PostgreSQL  
**ORM:** Prisma 7.8

## Regras de Ouro do Schema

1. **`User` contém apenas auth** — nunca dados de negócio, PIX ou credenciais
2. **Valores monetários são `Int` em centavos** — R$ 1,00 = 100
3. **`creditor_id` em toda query de lista** — IDOR prevention obrigatória
4. **Credenciais de terceiros em `IntegrationConfig`** — nunca em `User`
5. **`is_registered: false` = Shadow User** — não pode autenticar

---

## Enums

| Enum | Valores |
|---|---|
| `PlanType` | FREE, STARTER, PRO, UNLIMITED |
| `SubStatus` | ACTIVE, INACTIVE, PAUSED, CANCELED, OVERDUE, PENDING |
| `SubPeriod` | MONTHLY, YEARLY |
| `SubModule` | HOME, CHARGES, CLIENTS, REPORTS, EXCEL_IMPORT |
| `ChargeStatus` | PENDING, PAID, OVERDUE, CANCELED |
| `TriggerType` | MANUAL, AUTO_REMINDER_BEFORE, AUTO_REMINDER_DUE, AUTO_REMINDER_OVERDUE |
| `Frequency` | WEEKLY, MONTHLY, YEARLY |
| `PixKeyType` | CPF, CNPJ, PHONE, EMAIL, EVP |
| `MessageTrigger` | MANUAL, BEFORE_DUE, ON_DUE, OVERDUE |
| `WithdrawalStatus` | PENDING, PROCESSING, CONFIRMED, FAILED, REVERSED |

---

## Modelos

### User

Identidade e autenticação apenas.

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | String (UUID) | PK |
| `phone` | String (unique) | DDI+DDD+Número (ex: 5511999999999) |
| `name` | String | Nome do usuário |
| `email` | String? (unique) | E-mail (opcional) |
| `password_hash` | String? | Hash bcrypt (nunca expor) |
| `is_registered` | Boolean (false) | false = Shadow User |
| `avatar_url` | String? | URL da foto de perfil |
| `whatsapp_opted_out` | Boolean (false) | true = não receber automações |
| `created_at / updated_at` | DateTime | Timestamps automáticos |

**Relações:** `charges_as_creditor`, `charges_as_debtor`, `clients_as_creditor`, `clients_as_debtor`, `creditor_profile`, `subscription`, `integration_config`, `withdrawals`, `audit_logs`

---

### CreditorProfile

Dados comerciais separados do User.

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | String (UUID) | PK |
| `user_id` | String (unique FK) | 1:1 com User |
| `business_name` | String? | Nome empresa/profissional |
| `document` | String? | CPF ou CNPJ |
| `logo_url` | String? | URL da logo |
| `pix_key` | String? | Chave PIX |
| `pix_key_type` | PixKeyType? | Tipo da chave |
| `pix_merchant_name` | String? (max 25) | Nome no protocolo PIX |
| `pix_qr_code_url` | String? | URL do QR Code |

**Relações:** `message_templates` (1:N)

**⚠️ Cuidado:** `pix_merchant_name` tem limite de 25 caracteres por protocolo PIX. Validar no DTO.

---

### IntegrationConfig

Credenciais de terceiros. Um registro por usuário.

| Campo | Tipo | Descrição |
|---|---|---|
| `user_id` | String (unique FK) | 1:1 com User |
| `zapi_instance_id` | String? | ID instância Z-API |
| `zapi_instance_token` | String? | Token instância Z-API |
| `allows_automation` | Boolean (true) | Master switch de automações |
| `automation_days_before` | Int (2) | Dias antes do vencimento para lembrete |
| `automation_days_after` | Int (1) | Dias após vencimento para cobrança |
| `send_hour` | Int (9) | Hora de envio em BRT (0-23) |
| `allow_before_due` | Boolean (true) | Habilita lembrete antes do vencimento |
| `allow_on_due` | Boolean (true) | Habilita lembrete no dia do vencimento |
| `allow_overdue` | Boolean (true) | Habilita cobrança após vencimento |
| `asaas_customer_id` | String? | ID do lojista no Asaas |
| `asaas_wallet_id` | String? | Sub-conta Asaas Connect |
| `asaas_account_key` | String? | **Criptografado AES-256-GCM** |
| `split_terms_accepted_at` | DateTime? | Quando aceitou os termos de split |
| `split_terms_version` | String? | Versão dos termos aceitos |

**🔴 Risco:** `asaas_account_key` deve sempre ser criptografado antes de salvar e descriptografado apenas no momento de uso. Nunca logar seu valor.

---

### Subscription

Plano ativo do usuário. Um registro por usuário.

| Campo | Tipo | Descrição |
|---|---|---|
| `user_id` | String (unique FK) | 1:1 com User |
| `plan_type` | PlanType | FREE, STARTER, PRO, UNLIMITED |
| `status` | SubStatus (PENDING) | Estado atual do plano |
| `period` | SubPeriod (MONTHLY) | Mensal ou anual |
| `current_period_start` | DateTime? | Início do período atual |
| `current_period_end` | DateTime? | Fim do período atual |
| `asaas_id` | String? (unique) | ID da assinatura no Asaas |
| `asaas_payment_id` | String? | ID do último pagamento no Asaas |
| `last_payment_at` | DateTime? | Data do último pagamento |
| `payment_failed_at` | DateTime? | Quando falhou o pagamento |
| `payment_failure_reason` | String? | Motivo da falha |

**⚠️ Cuidado:** `current_period_end` é calculado localmente (+1 mês/ano). Pode divergir do Asaas. O CRON de sync (`6h diário`) corrige divergências.

---

### Charge

Cobranças individuais (PIX direto ou intermediadas).

| Campo | Tipo | Descrição |
|---|---|---|
| `creditor_id` | String (FK) | Quem cobra |
| `debtor_id` | String (FK) | Quem paga (pode ser Shadow User) |
| `amount` | Int | **Centavos** (R$ 50,00 = 5000) |
| `description` | String | Descrição da cobrança |
| `due_date` | DateTime | Data de vencimento |
| `status` | ChargeStatus (PENDING) | PENDING, PAID, OVERDUE, CANCELED |
| `payment_date` | DateTime? | Quando foi pago |
| `custom_message` | String? | Mensagem customizada por cobrança |
| `is_intermediated` | Boolean (false) | Se usa split Asaas |
| `platform_fee_pct` | Decimal? | % de taxa de intermediação |
| `asaas_payment_id` | String? | ID no Asaas (index para webhook) |
| `asaas_invoice_url` | String? | URL de pagamento para o devedor |
| `recurring_charge_id` | String? (FK) | Gerada por recorrência? |

**Index:** `@@index([asaas_payment_id])` — usado pelo webhook para lookup rápido.

---

### RecurringCharge

Regra de geração de cobranças recorrentes.

| Campo | Tipo | Descrição |
|---|---|---|
| `creditor_id` | String (FK) | Criador da regra |
| `amount` | Int | Valor em centavos |
| `frequency` | Frequency | WEEKLY, MONTHLY, YEARLY |
| `next_generation_date` | DateTime | Próxima data de geração |
| `active` | Boolean (true) | Regra ativa? |
| `max_installments` | Int? | null = sem limite |

**Relações:** `debtors` (via `RecurringChargeDebtor`), `charges` (geradas)

---

### WithdrawalRecord

Auditoria de saques PIX.

| Campo | Tipo | Descrição |
|---|---|---|
| `idempotency_key` | String (unique) | UUID gerado no front-end |
| `value` | Decimal(10,2) | Valor do saque |
| `pix_key_masked` | String | Versão mascarada para exibição |
| `pix_key_type` | String | Tipo da chave PIX |
| `status` | WithdrawalStatus | PENDING→PROCESSING→CONFIRMED/FAILED |
| `asaas_transfer_id` | String? | ID da transferência no Asaas |
| `failure_reason` | String? | Motivo de falha |
| `processed_at / confirmed_at / failed_at` | DateTime? | Timestamps por estado |

**🔴 Risco:** `pix_key_masked` é armazenada (mascarada). A chave completa nunca é persistida — apenas enviada ao Asaas no momento do saque.

---

### WebhookEvent

Idempotência e auditoria de webhooks.

| Campo | Tipo | Descrição |
|---|---|---|
| `source` | String | 'ASAAS' ou 'ZAPI' |
| `event_type` | String | Ex: 'PAYMENT_CONFIRMED' |
| `asaas_event_id` | String? (unique) | SHA-256(event:entityId) |
| `payload` | Json | Corpo completo do webhook |
| `processed` | Boolean (false) | Já foi processado? |
| `retry_count` | Int (0) | Número de retentativas |
| `error` | String? | Último erro |

**Indexes:** `(source, event_type)`, `(processed, created_at)`

---

### AuditLog

Rastreamento de ações importantes.

| Campo | Tipo | Descrição |
|---|---|---|
| `user_id` | String? (FK) | Quem realizou (null = sistema) |
| `action` | String | Ex: CHARGE_SENT, SUBSCRIPTION_ACTIVATED |
| `entity` | String | Nome da tabela afetada |
| `entity_id` | String | ID do registro |
| `details` | Json? | Dados adicionais |
| `ip_address` | String? | IP da requisição |

**🔴 Regra:** `details` nunca deve conter senha, token, chave PIX completa ou dados de cartão.

---

### SplitTerm

Taxas e termos de intermediação (dinâmico).

| Campo | Tipo | Descrição |
|---|---|---|
| `version` | String (unique) | Ex: '2.0.0' |
| `is_active` | Boolean (true) | Versão vigente? |
| `content` | Text | Texto dos termos |
| `platform_fee_pct` | Decimal (1.0) | Taxa da plataforma |
| `asaas_pix_fee` | String | Taxa PIX Asaas (texto) |
| `asaas_boleto_fee` | String | Taxa boleto |
| `asaas_card_fee` | String | Taxa cartão |

**⚠️ Débito:** Taxa de split ainda hardcoded em alguns pontos do código. `SplitTerm` está no schema mas não é lida em todos os fluxos.

---

## Diagrama de Relações

```
User 1──1 CreditorProfile
User 1──1 IntegrationConfig
User 1──1 Subscription
User 1──N WithdrawalRecord
User 1──N AuditLog

User (creditor) 1──N Charge (DebtorCharges)
User (debtor)   N──1 Charge (CreditorCharges)

CreditorProfile 1──N MessageTemplate

RecurringCharge 1──N RecurringChargeDebtor N──1 User
RecurringCharge 1──N Charge (recurring_charge_id)

Charge 1──N MessageHistory

Client N──1 User (creditor)
Client N──1 User (debtor)
```
