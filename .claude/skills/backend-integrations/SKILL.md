---
name: backend-integrations
description: Integrações do RecebeFácil com Z-API (WhatsApp) e Asaas (gateway de pagamento) — endpoints, webhooks, idempotência e CRON jobs.
when_to_use: Quando implementar envio de WhatsApp, webhook do Asaas, CRON de automação, checkout de assinatura, ativação de plano ou transição PENDING → OVERDUE.
---

## Z-API — Configuração por Instância

Credenciais são **por lojista**, armazenadas em `IntegrationConfig` (não em variáveis de ambiente):

```ts
// Nunca env vars como fonte primária — usar IntegrationConfig
const config = await this.prisma.integrationConfig.findUnique({ where: { user_id: userId } });
const credentials = {
  instanceId: config.zapi_instance_id,
  token: config.zapi_instance_token,
  clientToken: process.env.ZAPI_CLIENT_TOKEN, // header obrigatório
};
```

URL de envio: `https://api.z-api.io/instances/{instanceId}/token/{instanceToken}/send-text`

## WhatsAppService — Único Ponto de Integração

Nenhum controller ou service chama Z-API diretamente. Apenas `src/whatsapp/whatsapp.service.ts`.

```ts
// Payload de envio
{ phone: '5511999999999', message: 'texto' }

// Response
{ zapiId: { id: 'abc123' } }  // salvar zapi_message_id em MessageHistory
```

**Throttle em bulk:** aguardar 1-2s entre mensagens (`await new Promise(r => setTimeout(r, 1500))`).

**Opt-out:** `User.whatsapp_opted_out = true` (NOT `IntegrationConfig.allows_automation`).
Filtrar com `where: { debtor: { whatsapp_opted_out: false } }` antes de enviar.

---

## Asaas — Configuração

```env
ASAAS_API_KEY=           # Chave da conta principal (plataforma)
ASAAS_WEBHOOK_SECRET=    # Token para validar webhook
ASAAS_API_URL=           # sandbox.asaas.com (dev) | asaas.com (prod)
```

`asaas_account_key` de cada lojista fica em `IntegrationConfig` **criptografada AES-256-GCM** (via `CryptoService`). Descriptografar apenas no momento de uso.

---

## Webhook Asaas — Fluxo Completo (produção atual)

**Rota:** `POST /integrations/asaas/webhook` (não `/webhooks/asaas`)  
**Acesso:** `@Public()` — validação manual do token

```ts
// 1. Validar token
if (!token || token !== process.env.ASAAS_WEBHOOK_SECRET) {
  throw new UnauthorizedException('Invalid webhook token');
}

// 2. Computar fingerprint SHA-256 para idempotência
const entityId = body.payment?.id ?? body.subscription?.id ?? body.transfer?.id ?? 'unknown';
const fingerprint = createHash('sha256').update(`${body.event}:${entityId}`).digest('hex');

// 3. Verificar duplicata
const existing = await this.prisma.webhookEvent.findUnique({
  where: { asaas_event_id: fingerprint },
  select: { id: true, processed: true },
});
if (existing?.processed) return { received: true, duplicate: true };

// 4. Salvar WebhookEvent ANTES de responder (garante rastreabilidade)
const webhookEvent = await this.prisma.webhookEvent.upsert({
  where: { asaas_event_id: fingerprint },
  update: {},
  create: { source: 'ASAAS', event_type: body.event, asaas_event_id: fingerprint, payload: body },
});

// 5. Enfileirar no pg-boss — SEMPRE responder 200 imediatamente
await this.pgBoss.send(WEBHOOK_ASAAS_QUEUE, { webhookEventId: webhookEvent.id });
return { received: true };
```

## AsaasWebhookWorker — Retry Policy

Fila: `asaas-webhook` | DLQ: `asaas-webhook-dlq`

```ts
// Configuração da fila (em onApplicationBootstrap)
await pgBoss.instance.createQueue(WEBHOOK_ASAAS_QUEUE, {
  retryLimit: 5,
  retryDelay: 30,
  retryBackoff: true,           // backoff exponencial
  deadLetter: WEBHOOK_ASAAS_DLQ,
});

// Worker
async processEvent(webhookEventId: string) {
  const event = await prisma.webhookEvent.findUnique({ where: { id: webhookEventId } });
  if (!event || event.processed) return; // idempotência

  await dispatch(event.event_type, event.payload);
  await prisma.webhookEvent.update({
    where: { id: webhookEventId },
    data: { processed: true, processed_at: new Date() },
  });
}
```

## Eventos Asaas Processados

| Evento | Ação |
|---|---|
| `PAYMENT_CONFIRMED` / `PAYMENT_RECEIVED` | Ativar assinatura (`activateSubscriptionByAsaasId`) |
| `PAYMENT_RESTORED` | Reativar assinatura cancelada |
| `PAYMENT_OVERDUE` | Grace period 4 dias → downgrade FREE |
| `PAYMENT_DELETED` / `PAYMENT_REFUNDED` | Downgrade FREE imediato |
| `SUBSCRIPTION_CANCELED` / `SUBSCRIPTION_DELETED` | Downgrade FREE |
| `TRANSFER_DONE` | `WithdrawalRecord.status = CONFIRMED` |
| `TRANSFER_FAILED` | `WithdrawalRecord.status = FAILED` |

---

## Fluxo de Saque Seguro (WithdrawalRecord)

**Rota:** `POST /integrations/finance/withdraw`  
**Requer:** `@RequiresModule('FINANCE')` (PRO/UNLIMITED)

```
1. Front-end gera UUID ANTES de enviar (idempotencyKey)
2. Verificar idempotência: WithdrawalRecord com mesmo idempotencyKey?
   → PROCESSING/CONFIRMED → retornar estado atual (não reprocessar)
   → FAILED → permitir novo saque com novo UUID
3. Descriptografar asaas_account_key via CryptoService
4. Verificar saldo real no Asaas (AsaasService.getAccountBalance)
   → balance < value → BadRequestException
5. Transação Prisma: verificar PENDING/PROCESSING existente → ConflictException
   → Criar WithdrawalRecord (status: PENDING)
6. Chamar Asaas FORA da transação (transferViaPixFromSubaccount)
   → Sucesso: status = PROCESSING, asaas_transfer_id salvo
   → Falha: status = FAILED, failure_reason salvo
7. Confirmação assíncrona via webhook TRANSFER_DONE/TRANSFER_FAILED
```

**Regra crítica:** Transação Prisma → Asaas fora da transação. Nunca inverter essa ordem.

---

## CRON de Automação (lógica real)

**Não é fixo às 8h** — roda a cada hora e verifica quem tem `send_hour` igual à hora atual em BRT:

```ts
@Cron('0 * * * *') // toda hora cheia
async handleDailyBillingSync() {
  await this.markOverdueCharges();        // PENDING → OVERDUE (PIX direto apenas)
  const currentHour = this.getBRTHour(); // converte UTC → BRT
  await this.processAutomationQueue(currentHour);
}

getBRTHour(): number {
  return new Date(
    new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }),
  ).getHours();
}

// markOverdueCharges: APENAS is_intermediated = false
await prisma.charge.updateMany({
  where: { status: 'PENDING', is_intermediated: false, due_date: { lt: today } },
  data: { status: 'OVERDUE' },
});
```

**Filtro de elegibilidade para lembretes:**
```ts
// Apenas credores com send_hour = currentHour E plano ATIVO STARTER/PRO/UNLIMITED
where: {
  allows_automation: true,
  send_hour: currentHour,
  user: { subscription: { status: 'ACTIVE', plan_type: { in: ['STARTER', 'PRO', 'UNLIMITED'] } } }
}
```

**Anti-spam:** verificar `MessageHistory` com mesmo `charge_id` + mesmo trigger hoje antes de enviar.

## CRON de Recorrências

```ts
@Cron('0 0 * * *') // meia-noite UTC
async handleRecurringChargeGeneration() {
  const rules = await prisma.recurringCharge.findMany({
    where: { active: true, next_generation_date: { lte: today } },
  });
  for (const rule of rules) {
    // Verificar max_installments → desativar se atingido
    // Criar Charge para cada debtor
    // Avançar next_generation_date
  }
}
```

## CRON de Monitoramento

```ts
// Diário às 7h: DLQ alert
@Cron('0 7 * * *')
async checkDlqHealth() {
  const stats = await pgBoss.instance.getQueueSize(WEBHOOK_ASAAS_DLQ);
  if (stats > 5) await prisma.auditLog.create({ data: { action: 'WEBHOOK_DLQ_ALERT', ... } });
}

// Diário às 8h: saques stuck
@Cron('0 8 * * *')
async checkStuckWithdrawals() {
  // WithdrawalRecord PROCESSING > 24h → WITHDRAWAL_STUCK_ALERT
}
```

---

## Fluxo de Checkout de Assinatura

```
POST /subscription/checkout { planType, period, document? }
  → getOrCreateCustomer(userId, document?) → asaas_customer_id
  → createPlanSubscription(userId, planType, period) → invoiceUrl
  → Salvar Subscription: status = PENDING, asaas_id
  → Retornar { invoiceUrl } → front redireciona
  → Usuário paga → webhook PAYMENT_CONFIRMED → ativa plano
```

---

## Anti-patterns

- Nunca usar rota `/webhooks/asaas` — a rota correta é `/integrations/asaas/webhook`
- Nunca processar webhook de forma síncrona — sempre `pg-boss.send()` e responder 200
- Nunca usar `upsert` de Subscription como idempotência de webhook — usar SHA-256 + WebhookEvent
- Nunca salvar `asaas_account_key` em plain-text — criptografar com `CryptoService`
- Nunca chamar Z-API fora do `WhatsAppService`
- Nunca commitar ASAAS_API_KEY ou tokens Z-API no código
- Nunca usar `IntegrationConfig.allows_automation` para opt-out de devedor — usar `User.whatsapp_opted_out`
- Nunca assumir CRON fixo — é por `send_hour` do lojista
- Nunca marcar cobranças intermediadas como OVERDUE no CRON (`is_intermediated: false` no WHERE)
