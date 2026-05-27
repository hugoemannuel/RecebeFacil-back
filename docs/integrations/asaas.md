# Integração: Asaas

**Serviço:** `src/integrations/asaas.service.ts`  
**Webhook controller:** `src/integrations/asaas-webhook.controller.ts`  
**Worker:** `src/integrations/asaas-webhook.worker.ts`

## Autenticação

- Header: `access_token: {ASAAS_API_KEY}`
- `ASAAS_API_KEY` é a chave da **plataforma** (conta principal), não do lojista
- Sub-contas de lojistas usam `asaas_account_key` (criptografado em `IntegrationConfig`)
- **Nunca logar** `ASAAS_API_KEY` ou `asaas_account_key`

## URLs

| Ambiente | URL base |
|---|---|
| Sandbox | `https://sandbox.asaas.com/api/v3` |
| Produção | `https://asaas.com/api/v3` |

Controlado por `ASAAS_API_URL` em `.env`.

## Endpoints Utilizados

| Método | Endpoint | Uso |
|---|---|---|
| POST | `/customers` | Criar cliente (lojista ou devedor) |
| GET | `/customers?cpfCnpj={doc}` | Verificar se cliente já existe |
| POST | `/subscriptions` | Criar assinatura de plano |
| DELETE | `/subscriptions/{id}` | Cancelar assinatura |
| GET | `/subscriptions/{id}/payments` | Buscar cobranças da assinatura |
| POST | `/payments` | Criar cobrança intermediada |
| GET | `/finance/balance` | Saldo da sub-conta |
| POST | `/transfers` | Transferência PIX (saque) |
| GET | `/accounts` | Criar sub-conta (onboarding split) |

## Recebimento de Webhooks

### Endpoint

```
POST /integrations/asaas/webhook
GET  /integrations/asaas/webhook  → { status: 'ok' } (health check)
```

Ambos são `@Public()` (sem JWT).

### Validação de Autenticidade

```typescript
// Header: asaas-access-token
if (!token || token !== ASAAS_WEBHOOK_SECRET) {
  throw new UnauthorizedException('Invalid webhook token');
}
```

### Idempotência

Fingerprint SHA-256 gerado a partir do evento:

```typescript
const key = `${body.event}:${body.payment?.id ?? body.subscription?.id ?? body.transfer?.id}`;
const fingerprint = createHash('sha256').update(key).digest('hex');
```

- Fingerprint salvo em `WebhookEvent.asaas_event_id` (unique)
- Evento duplicado → retorna `{ received: true, duplicate: true }`
- Evento novo → salva no banco → enfileira no pg-boss → retorna `{ received: true }`

**O controller sempre responde 200 imediatamente.** O processamento é assíncrono.

### Fluxo do Worker (`AsaasWebhookWorker`)

```
Job recebido do pg-boss: { webhookEventId }
        │
        ▼
Buscar WebhookEvent por ID
        │
   event.processed == true → log + retornar (idempotência)
        │
        ▼
dispatch(event_type, payload)
        │
   ┌────┴────────────────────────────┐
   │                                 │
sucesso                             falha
   │                                 │
UPDATE processed = true          increment retry_count
processed_at = now()             salvar error
                                 pg-boss retenta (até 5x)
                                 após 5x → DLQ
```

### Retry Policy

| Parâmetro | Valor |
|---|---|
| `retryLimit` | 5 |
| `retryDelay` | 30s |
| `retryBackoff` | true (exponencial) |
| DLQ | `asaas-webhook-dlq` |

### CRON de DLQ (diário às 7h)

Se a DLQ tiver mais de 5 jobs → `AuditLog: WEBHOOK_DLQ_ALERT`.  
**⚠️ Não há notificação automática para o desenvolvedor** — verificar `AuditLog` periodicamente.

## Eventos Processados

| Evento | Handler | Ação |
|---|---|---|
| `PAYMENT_CONFIRMED` | `handlePaymentConfirmed` | Ativar assinatura ou marcar cobrança como PAID |
| `PAYMENT_RECEIVED` | `handlePaymentConfirmed` | Mesmo handler |
| `PAYMENT_RESTORED` | `handlePaymentRestored` | Reativar assinatura |
| `PAYMENT_OVERDUE` | `handlePaymentOverdue` | Grace period 4 dias → downgrade |
| `PAYMENT_DELETED` | `handlePaymentDeleted` | Downgrade para FREE |
| `PAYMENT_REFUNDED` | `handlePaymentDeleted` | Downgrade para FREE |
| `SUBSCRIPTION_CANCELED` | `handleSubscriptionCanceled` | Downgrade para FREE |
| `SUBSCRIPTION_DELETED` | `handleSubscriptionCanceled` | Downgrade para FREE |
| `TRANSFER_DONE` | `handleTransferDone` | Confirmar saque |
| `TRANSFER_FAILED` | `handleTransferFailed` | Marcar saque como FAILED |
| Outros | — | Log de warning, ignorado |

## Configuração do Webhook no Painel Asaas

No painel Asaas, configurar:
- URL: `https://api.seudominio.com/integrations/asaas/webhook`
- Token: valor de `ASAAS_WEBHOOK_SECRET`
- Eventos: todos os listados acima
