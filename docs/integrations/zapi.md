# Integração: Z-API (WhatsApp)

**Serviço:** `src/whatsapp/whatsapp.service.ts`  
**Webhook:** `src/webhooks/zapi-webhook.module.ts`

## Visão Geral

Z-API é o gateway WhatsApp utilizado para envio de mensagens automáticas. Cada lojista usa sua própria instância Z-API (número de WhatsApp próprio).

## Credenciais

Armazenadas por instância em `IntegrationConfig`:

| Campo | Descrição |
|---|---|
| `zapi_instance_id` | ID da instância Z-API do lojista |
| `zapi_instance_token` | Token de autenticação da instância |

Variável global `ZAPI_CLIENT_TOKEN` (env) é usada como fallback ou para instâncias sem credencial própria.

## Endpoint de Envio

```
POST https://api.z-api.io/instances/{instanceId}/token/{instanceToken}/send-text

Headers:
  Content-Type: application/json
  Client-Token: {ZAPI_CLIENT_TOKEN}

Body:
  { phone: "5511999999999", message: "texto da mensagem" }

Response:
  { zapiId: { id: "abc123" } }
```

O `zapiId.id` é salvo em `MessageHistory.zapi_message_id` como prova de entrega.

## Throttling

Envios em bulk têm delay de **1-2 segundos** entre mensagens para evitar ban do número pelo WhatsApp. Implementado no `WhatsAppService`.

## Opt-out

Devedor responde "PARAR" → webhook Z-API chega em `POST /webhooks/zapi/message` → `User.whatsapp_opted_out = true`.

Cobranças para devedores opt-out são filtradas antes do envio no `AutomationService`.

## Recebimento de Mensagens (Webhook)

**Endpoint:** `POST /webhooks/zapi/message`  
**Módulo:** `src/webhooks/zapi-webhook.module.ts`  
**Acesso:** `@Public()`

Processamento atual:
- Detectar mensagens com texto "PARAR" (case-insensitive)
- Identificar `User` pelo número de telefone
- SET `whatsapp_opted_out = true`

## Rastreamento

Cada envio gera um `MessageHistory`:

| Campo | Valor |
|---|---|
| `charge_id` | Cobrança relacionada |
| `trigger_type` | MANUAL, AUTO_REMINDER_BEFORE, AUTO_REMINDER_DUE, AUTO_REMINDER_OVERDUE |
| `status` | SENT ou FAILED |
| `zapi_message_id` | ID retornado pelo Z-API |
| `error_details` | Detalhes do erro (nunca expor na API) |

## Envio Manual

`POST /charges/:id/notify` — disparo manual de lembrete para uma cobrança específica.  
Cria `MessageHistory` com `trigger_type = MANUAL`.

## Riscos e Cuidados

- **Instância desconectada** — se o número WhatsApp do lojista desconectar da Z-API, todos os envios falham silenciosamente (FAILED em `MessageHistory`)
- **Ban por volume** — enviar muitas mensagens rápidas pode resultar em ban. O throttle de 1-2s existe por isso.
- **Credenciais por lojista** — `zapi_instance_id` nulo significa que não há Z-API configurada; tratar antes de enviar
- **`error_details` privado** — nunca expor na API pública; apenas para diagnóstico interno
