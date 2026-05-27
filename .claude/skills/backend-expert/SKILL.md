---
name: backend-expert
description: Especialista sênior em back-end do RecebeFácil. Conhece toda a arquitetura NestJS, schema Prisma, regras de domínio, segurança, plan gating, CRON jobs e integrações Z-API/Asaas. Invocar para qualquer tarefa de back-end.
when_to_use: Qualquer tarefa de back-end — criar endpoint, service, DTO, guard, migration Prisma, CRON job, webhook, integração Z-API ou Asaas, regra de negócio de plano ou decisão arquitetural.
---

## Skills Especializadas — Consultar Antes de Implementar

| Skill | Quando usar |
|---|---|
| `/backend-architecture` | Criar módulo, controller, service, guard, estrutura de arquivos |
| `/backend-prisma` | Criar/alterar schema, migration, query Prisma, Shadow User |
| `/backend-security` | Endpoint com dados sensíveis, IDOR, auth, validação, criptografia |
| `/backend-plan-guard` | PlanGuard, PLAN_MODULES, limites por plano, recorrências |
| `/backend-integrations` | Asaas (webhook, saques, checkout), Z-API (WhatsApp), CRON jobs |
| `/backend-testing` | Criar ou modificar qualquer service, guard ou worker |

---

## Contexto de Domínio

**RecebeFácil** = plataforma de gestão de cobranças para micro/pequenos empreendedores.

- **Credor** = lojista assinante (usuário autenticado)
- **Devedor** = cliente do lojista (pode ser Shadow User)
- **Shadow User** = devedor não registrado (`is_registered: false`) — não pode autenticar
- **Cobrança PIX direto** = lojista cobra via QR Code próprio; confirma manualmente
- **Cobrança intermediada** = processada pelo Asaas com split automático (PRO/UNLIMITED)
- **Split** = taxa da plataforma retida automaticamente pelo Asaas sobre cada transação

---

## Módulos Críticos e Suas Dependências

```
IntegrationsModule  ← mais crítico: saques reais, webhook, Asaas, CryptoService
  └ AsaasService       ← wrapper da API Asaas
  └ AsaasWebhookWorker ← processa eventos via pg-boss
  └ CryptoService      ← AES-256-GCM para asaas_account_key

SubscriptionModule  ← monetização: planos, checkout, ativação via webhook
  └ usa AsaasService (forwardRef)

AutomationModule    ← CRON horário (lembretes) + CRON meia-noite (recorrências)
  └ usa WhatsAppService

QueueModule         ← pg-boss: filas de webhook + notificações
  └ usado por IntegrationsModule e AutomationModule
```

---

## Regras de Domínio Críticas

### Shadow User
Todo número de telefone que recebe cobrança vira `User` com `is_registered: false`. Ao se registrar, é promovido (update, não create). Shadow users **não autenticam** — JwtStrategy rejeita.

### Valores Monetários
Sempre `Int` em centavos. `R$ 150,00 = 15000`. Nunca `Float`.

### Cobrança Intermediada
- Apenas PRO e UNLIMITED
- `is_intermediated: true` → status de pagamento atualizado **apenas** via webhook Asaas
- CRON de OVERDUE **ignora** cobranças intermediadas (`is_intermediated: false` no WHERE)
- Sem reconciliação automática — cobranças intermediadas PENDING > 48h são estado zumbi ⚠️

### Saque Seguro
- `idempotency_key` = UUID gerado no front-end **antes** de enviar (não após falha)
- Transação Prisma → Asaas fora da transação (nunca inverter)
- `pix_key_masked` no banco — nunca a chave completa
- `asaas_account_key` descriptografada apenas no momento de uso (CryptoService)

### Webhook Asaas
- Fingerprint SHA-256(`event:entityId`) → `WebhookEvent.asaas_event_id` (unique)
- Controller responde 200 imediatamente → processa via pg-boss (AsaasWebhookWorker)
- Nunca processar de forma síncrona no controller

### PlanGuard
- Qualquer `SubStatus` diferente de `ACTIVE` → `effectivePlan = FREE`
- Isso inclui: OVERDUE, PAUSED, CANCELED, INACTIVE, PENDING
- `req.userPlan` disponível no controller após PlanGuard

---

## Planos e Módulos (resumo rápido)

| Módulo | FREE | STARTER | PRO | UNLIMITED |
|---|---|---|---|---|
| CHARGES | ✅ | ✅ | ✅ | ✅ |
| CLIENTS | ✗ | ✅ | ✅ | ✅ |
| EXCEL_IMPORT | ✗ | ✅ | ✅ | ✅ |
| CUSTOM_TEMPLATES | ✗ | ✅ | ✅ | ✅ |
| FINANCE | ✗ | ✗ | ✅ | ✅ |
| RECURRENCE | ✗ | ✗ | ✅ | ✅ |
| REPORTS | ✗ | ✗ | ✗ | ✅ |

---

## Infraestrutura Assíncrona (pg-boss)

Usa o **mesmo PostgreSQL** do Prisma — sem Redis ou RabbitMQ.

| Fila | Worker | Configuração |
|---|---|---|
| `asaas-webhook` | `AsaasWebhookWorker` | retryLimit: 5, backoff exponencial, DLQ: `asaas-webhook-dlq` |
| `whatsapp-notification` | `NotificationWorker` | retryLimit: 3, DLQ: `whatsapp-notification-dlq` |

Monitoramento: CRON diário 7h verifica DLQ. Se count > 5 → `AuditLog: WEBHOOK_DLQ_ALERT`.

---

## Segurança em Camadas

1. `ThrottlerGuard` (global) → 100 req/min
2. `JwtAuthGuard` (global) → valida JWT, rejeita shadow users
3. `ValidationPipe` (global) → whitelist, forbidNonWhitelisted
4. `PlanGuard` (por rota) → verifica plano
5. IDOR check (service) → WHERE creditor_id = userId
6. `CryptoService` → AES-256-GCM para credenciais em repouso

---

## Anti-patterns Críticos do Projeto

- Nunca campo de negócio na tabela `User` (pix_key, asaas_id, zapi_token)
- Nunca `@UseGuards(AuthGuard('jwt'))` nos controllers — já é APP_GUARD global
- Nunca processar webhook de forma síncrona no controller
- Nunca usar `PAST_DUE` — o enum correto é `OVERDUE`
- Nunca marcar cobranças intermediadas como OVERDUE no CRON
- Nunca salvar `asaas_account_key` sem criptografar
- Nunca salvar chave PIX completa — apenas `pix_key_masked`
- Nunca chamar Z-API fora do `WhatsAppService`
- Nunca usar `IntegrationConfig.allows_automation` para opt-out de devedor (usar `User.whatsapp_opted_out`)
- Nunca assumir CRON de lembretes é fixo às 8h — é por `send_hour` por lojista
- Nunca duplicar PLAN_MODULES — importar de `common/plan-modules.ts`
- Nunca usar `Float` para valores monetários — sempre `Int` (centavos)
- Nunca subir funcionalidade sem spec correspondente para services e workers

---

## Decisões Arquiteturais (contexto para não reverter)

| Decisão | Motivo |
|---|---|
| pg-boss no mesmo PostgreSQL | Sem infra extra; durabilidade garantida |
| WebhookEvent com SHA-256 | Idempotência robusta sem depender de ID único Asaas |
| `is_intermediated` em Charge | Separar fluxo de pagamento direto vs. split |
| `asaas_account_key` criptografada | Credencial financeira — AES-256-GCM obrigatório |
| CRON horário com `send_hour` por usuário | Cada lojista envia no horário configurado, não em horário fixo |
| User separado de CreditorProfile | Evitar vazamento de dados comerciais junto com auth |
| `effectivePlan = FREE` para qualquer status != ACTIVE | Downgrade automático seguro sem código adicional |
