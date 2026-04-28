---
name: backend-integrations
description: Integrações do RecebeFácil com Z-API (WhatsApp) e Asaas (gateway de pagamento) — endpoints, webhooks, idempotência e CRON jobs.
when_to_use: Quando implementar envio de WhatsApp, webhook do Asaas, CRON de automação, checkout de assinatura, ativação de plano ou transição PENDING → OVERDUE.
---

## Z-API — Configuração

```env
ZAPI_INSTANCE_ID=
ZAPI_INSTANCE_TOKEN=
ZAPI_CLIENT_TOKEN=     # Header obrigatório em todas as chamadas
ZAPI_BASE_URL=https://api.z-api.io/instances
DISABLE_WHATSAPP=true  # Em dev: mockar envios, não consumir API real
```

URL base: `{ZAPI_BASE_URL}/{instanceId}/token/{token}/`

## WhatsAppService — Único Ponto de Integração

Nenhum controller chama Z-API diretamente. Apenas `WhatsAppService` encapsula todas as chamadas.

### Endpoints Z-API

```ts
// 1. Texto
POST /send-text
{ phone: '5511999999999', message: 'Olá *João*! 💰\nSua cobrança vence hoje.' }
// Suporte: *negrito*, _itálico_, \n, emojis

// 2. Imagem (QR Code PIX)
POST /send-image
{ phone: '5511999999999', image: 'data:image/png;base64,...', caption: 'Escaneie o QR Code' }

// 3. Botão PIX Nativo ⭐ (diferencial)
POST /send-button-pix
{ phone: '5511999999999', pixKey: '11999999999', type: 'PHONE', merchantName: 'João Barbearia' }
// type: CPF | CNPJ | PHONE | EMAIL | EVP
// merchantName: máx 25 chars (protocolo PIX)
```

### Ordem de Envio

1. `sendText()` — mensagem principal (sempre)
2. `sendImage()` — QR Code (se `pix_qr_code_url` configurado)
3. `sendPixButton()` — botão PIX nativo (se `pix_key` configurado)

### MessageHistory após Envio

```ts
await this.prisma.messageHistory.create({
  data: {
    charge_id: charge.id,
    trigger_type: 'MANUAL',
    status: 'SENT',                    // ou 'FAILED'
    zapi_message_id: zapiResponse.id,  // para rastreamento
    error_details: null,               // se FAILED: logar internamente, nunca expor na API
  }
});
```

### Throttle em Envio em Massa

```ts
// Aguardar 1-2 segundos entre cada envio para evitar banimento do número
await new Promise(r => setTimeout(r, 1500));
```

## Asaas — Configuração

```env
ASAAS_API_KEY=
ASAAS_WEBHOOK_SECRET=
ASAAS_API_URL=https://www.asaas.com/api/v3  # sandbox em dev
```

## Fluxo de Checkout (SubscriptionModule)

```
POST /subscription/checkout { planType, period }
  → Verificar asaas_customer_id em IntegrationConfig
  → Se não tiver: POST /customers no Asaas → salvar asaas_customer_id
  → POST /payments { customer, value, dueDate, billingType: 'UNDEFINED' }
  → Retornar { invoiceUrl } → front-end redireciona
```

## Webhook Asaas — Validação Obrigatória

```ts
@Post('/webhooks/asaas')
async handleWebhook(@Req() req, @Headers('asaas-access-token') token: string) {
  if (token !== process.env.ASAAS_WEBHOOK_SECRET) {
    throw new UnauthorizedException('Webhook inválido.');
  }
  await this.subscriptionService.handleWebhookEvent(req.body);
}
```

## Idempotência de Webhooks

```ts
// activatePlan usa upsert — seguro para chamadas duplicadas:
await this.prisma.subscription.upsert({
  where: { user_id: userId },
  update: { plan_type, status: 'ACTIVE', asaas_payment_id },
  create: { ... },
});
// Verificar asaas_payment_id antes de qualquer ação para evitar duplicação
```

## Eventos Asaas

```ts
'PAYMENT_CONFIRMED' → activatePlan() → Subscription.status = 'ACTIVE'
'PAYMENT_OVERDUE'   → Subscription.status = 'PAST_DUE'
'PAYMENT_DELETED'   → downgradeToFree(reason)
'PAYMENT_REFUNDED'  → downgradeToFree(reason)
```

## CRON Jobs

```ts
// Transição PENDING → OVERDUE (meia-noite todo dia)
@Cron('0 0 0 * * *')
async markOverdueCharges() {
  await this.prisma.charge.updateMany({
    where: { status: 'PENDING', due_date: { lt: new Date() } },
    data: { status: 'OVERDUE' },
  });
}

// Automação WhatsApp — STARTER/PRO
@Cron(CronExpression.EVERY_DAY_AT_8AM)
async sendAutomatedReminders() { ... }
```

## Opt-Out do Devedor

```ts
// Se devedor responder "PARAR" (webhook Z-API):
await this.prisma.integrationConfig.update({
  where: { user_id: debtorId },
  data: { allows_automation: false },
});
// Verificar allows_automation antes de qualquer envio automático
```

## Anti-patterns

- Nunca chamar Z-API diretamente de um controller
- Nunca commitar `ASAAS_API_KEY` ou credenciais Z-API no git
- Nunca processar webhook sem validar `asaas-access-token`
- Nunca processar o mesmo webhook duas vezes — verificar `asaas_payment_id`
- Nunca armazenar dados de cartão — PCI DSS proibido
- Nunca logar `asaas_account_key` (criptografar em repouso AES-256)
- Nunca enviar mensagens agressivas — risco de banimento do número WhatsApp
