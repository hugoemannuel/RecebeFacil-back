# Migrations

**Pasta:** `back-end/prisma/migrations/`  
**Total:** 13 migrations (até 2026-05-26)

## Histórico

| Migration | Data | Conteúdo |
|---|---|---|
| `20260427004015_init_r_n` | 2026-04-27 | Schema inicial: User, Charge, Subscription, CreditorProfile, IntegrationConfig |
| `20260427040128_add_subscription_period_and_modules` | 2026-04-27 | `SubPeriod` (MONTHLY/YEARLY), controle de módulos |
| `20260427042700_normalize_schema_creditor_profile_integration_config` | 2026-04-27 | Normalização: CreditorProfile separada, integrações em IntegrationConfig |
| `20260428133416_add_demo_attempt` | 2026-04-28 | Tabela `DemoAttempt` para rate limit por IP |
| `20260429021120_add_payment_failure_tracking` | 2026-04-29 | `payment_failed_at`, `payment_failure_reason` em Subscription |
| `20260429235823_add_client_model` | 2026-04-29 | Tabela `Client` (vínculo credor↔devedor) |
| `20260501045704_add_avatar_url` | 2026-05-01 | `avatar_url` em User |
| `20260501170649_add_automation_days` | 2026-05-01 | `automation_days_before/after`, `send_hour` em IntegrationConfig |
| `20260514220737_add_max_installments` | 2026-05-14 | `max_installments` em RecurringCharge |
| `20260520120000_add_send_hour_and_trigger_flags` | 2026-05-20 | `allow_before_due`, `allow_on_due`, `allow_overdue` em IntegrationConfig |
| `20260520140000_add_missing_fields` | 2026-05-20 | Campos complementares |
| `20260524023049_add_withdrawal_record` | 2026-05-24 | Tabela `WithdrawalRecord` (saques seguros) |
| `20260526194202_add_webhook_event` | 2026-05-26 | Tabela `WebhookEvent` + índice em `Charge.asaas_payment_id` |

## Comandos

```bash
# Aplicar migrations pendentes e gerar Prisma Client
npx prisma migrate dev

# Apenas gerar Prisma Client (sem aplicar migration)
npx prisma generate

# Aplicar em produção (sem criar nova migration)
npx prisma migrate deploy

# Visualizar banco de dados
npx prisma studio

# Resetar banco e reaplicar tudo (DESTRUTIVO — dev apenas)
npx prisma migrate reset
```

## Como Criar uma Nova Migration

1. Alterar `prisma/schema.prisma`
2. Executar: `npx prisma migrate dev --name descricao_da_mudanca`
3. Verificar o arquivo SQL gerado em `prisma/migrations/`
4. Commitar o schema + o arquivo de migration juntos

## Regras

- Nunca editar um arquivo de migration existente
- Migrations em produção sempre via `npx prisma migrate deploy`
- Migrations destrutivas (DROP COLUMN, DROP TABLE) exigem revisão manual do SQL gerado
- O script de deploy (`npm run start:prod`) já executa `npx prisma migrate deploy` antes de subir o servidor
