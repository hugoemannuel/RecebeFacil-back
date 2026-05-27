# Fluxo: Assinatura de Plano

**Módulo:** `src/subscription/`  
**Integração:** Asaas (gateway de pagamento)

## Visão Geral

O usuário escolhe um plano → Asaas gera cobrança → usuário paga → webhook confirma → plano ativado.

O back-end **não ativa o plano diretamente** após o checkout. A ativação sempre ocorre via webhook assíncrono.

## Fluxo Detalhado

```
1. POST /subscription/checkout
   Body: { planType: 'PRO', period: 'MONTHLY', document?: 'CPF/CNPJ' }
        │
        ▼
2. AsaasService.getOrCreateCustomer(userId, document?)
   → Verifica se asaas_customer_id já existe em IntegrationConfig
   → Se não: POST /customers no Asaas → salva asaas_customer_id
        │
        ▼
3. AsaasService.createPlanSubscription(userId, planType, period)
   → POST /subscriptions no Asaas
   → Busca cobrança gerada: GET /subscriptions/{id}/payments
   → Retorna invoiceUrl para o front-end redirecionar
        │
        ▼
4. Salva Subscription:
   - status: PENDING
   - asaas_id: ID da assinatura Asaas
   - plan_type: plano escolhido
        │
        ▼
5. Front-end redireciona usuário para invoiceUrl (página Asaas)
        │
        ▼
6. Usuário paga no Asaas
        │
        ▼
7. Asaas envia webhook POST /integrations/asaas/webhook
   { event: 'PAYMENT_CONFIRMED', payment: { id, subscriptionId, ... } }
        │
        ▼
8. AsaasWebhookWorker processa:
   SubscriptionService.activateSubscriptionByAsaasId(asaasId, paymentId)
   → UPDATE Subscription:
     - status: ACTIVE
     - current_period_start: now()
     - current_period_end: now() + 1 mês ou 1 ano
     - last_payment_at: now()
   → AuditLog: SUBSCRIPTION_ACTIVATED
```

## Outros Endpoints

### `POST /subscription/cancel`
- Chama Asaas: DELETE `/subscriptions/{asaas_id}`
- UPDATE local: `status = CANCELED`

### `POST /subscription/retry-payment`
- Busca cobrança pendente no Asaas
- Se não houver: cria nova cobrança
- Rate limit: 2 req / 5 min

### `POST /subscription/reactivate`
- Cancela assinatura antiga no Asaas
- Cria nova via `createPlanSubscription()`
- Retorna nova `invoiceUrl`

### `POST /subscription/change-plan`
- Cancela assinatura atual + cria nova com novo plano
- Retorna `invoiceUrl` do novo plano

### `GET /subscription/invoices`
- Busca `GET /subscriptions/{asaas_id}/payments` no Asaas
- Lista faturas com status e link de pagamento

### `POST /subscription/sync`
- Sincroniza assinaturas com `status: PENDING` há mais de 1h
- Corrige divergências entre estado local e Asaas

## Eventos de Webhook que Afetam o Plano

| Evento Asaas | Ação |
|---|---|
| `PAYMENT_CONFIRMED` / `PAYMENT_RECEIVED` | Ativar assinatura |
| `PAYMENT_RESTORED` | Reativar assinatura |
| `PAYMENT_OVERDUE` | Grace period 4 dias → downgrade para FREE |
| `PAYMENT_DELETED` / `PAYMENT_REFUNDED` | Downgrade para FREE |
| `SUBSCRIPTION_CANCELED` / `SUBSCRIPTION_DELETED` | Downgrade para FREE |

## Estados do Plano

```
[sem Subscription] → PlanGuard trata como FREE

POST /subscription/checkout
        ↓
status: PENDING (sem acesso aos módulos pagos)
        ↓
  webhook PAYMENT_CONFIRMED
        ↓
status: ACTIVE (acesso liberado)
        ↓
  falha de pagamento
        ↓
status: OVERDUE (grace period 4 dias)
        ↓
  após 4 dias
        ↓
status: CANCELED (downgrade para FREE)
```

## Riscos e Cuidados

- **Preços hardcoded** no serviço — mudança de preço exige deploy ⚠️
- **`current_period_end` calculado localmente** — pode divergir do Asaas; CRON de sync corrige
- **Ativação só ocorre via webhook** — se pg-boss cair no momento do pagamento, o job vai para DLQ
- Não alterar `activateSubscriptionByAsaasId()` sem entender o webhook flow completo
