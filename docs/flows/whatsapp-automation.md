# Fluxo: Automação de Lembretes WhatsApp

**Módulo:** `src/automation/`  
**Serviço:** `AutomationService.handleDailyBillingSync()`  
**Requer plano:** STARTER, PRO ou UNLIMITED (verificado no CRON)

## Visão Geral

CRON horário verifica quais credores têm `send_hour` igual à hora atual em BRT e dispara lembretes WhatsApp para devedores elegíveis.

## CRON: Lembretes Horários

**Horário:** `0 * * * *` (toda hora cheia, UTC)  
**Arquivo:** `src/automation/automation.service.ts`

```
1. markOverdueCharges()
   → UPDATE charges SET status = OVERDUE
     WHERE status = PENDING
       AND is_intermediated = false
       AND due_date < hoje (startOfDay)
        │
        ▼
2. currentHour = getBRTHour()
   → Converte UTC para BRT (America/Sao_Paulo)
        │
        ▼
3. processAutomationQueue(currentHour)
   → Buscar IntegrationConfig com:
     - allows_automation = true
     - send_hour = currentHour
     - subscription.status = ACTIVE
     - subscription.plan_type IN (STARTER, PRO, UNLIMITED)
        │
        ▼
4. Para cada creditor encontrado:
   → Buscar charges com status PENDING ou OVERDUE
     E due_date entre:
       - maxDaysAfter dias antes de hoje (cobranças atrasadas)
       - maxDaysBefore dias após hoje (lembretes futuros)
   → Filtrar: debtor.whatsapp_opted_out = false
        │
        ▼
5. Para cada charge elegível:
   → diffDays = diferença entre due_date e hoje
   → Determinar gatilho:
     - diffDays == automation_days_before E status PENDING E allow_before_due
       → trigger = BEFORE_DUE
     - diffDays == 0 E status PENDING E allow_on_due
       → trigger = ON_DUE
     - diffDays == -automation_days_after E status OVERDUE E allow_overdue
       → trigger = OVERDUE
   → Verificar anti-spam: MessageHistory tem envio hoje com mesmo trigger?
     - Se sim → pular
        │
        ▼
6. Enviar via WhatsAppService:
   → Buscar template customizado do creditor_profile (MessageTemplate)
   → Se não houver → usar template padrão de system-templates.ts
   → Substituir variáveis: {{nome}}, {{valor}}, {{vencimento}}, {{chave_pix}}
   → WhatsAppService.sendText(phone, message, credentials)
        │
        ▼
7. CREATE MessageHistory:
   - charge_id, trigger_type, status (SENT | FAILED)
   - zapi_message_id (retornado pela Z-API)
   - error_details (em caso de FAILED)
```

## Configurações por Lojista

Campos em `IntegrationConfig`:

| Campo | Padrão | Descrição |
|---|---|---|
| `allows_automation` | true | Master switch — desabilita tudo |
| `send_hour` | 9 | Hora de envio em BRT (0-23) |
| `automation_days_before` | 2 | Dias antes do vencimento |
| `automation_days_after` | 1 | Dias após vencimento |
| `allow_before_due` | true | Habilita lembrete antes |
| `allow_on_due` | true | Habilita lembrete no dia |
| `allow_overdue` | true | Habilita cobrança após vencimento |

## Gatilhos

| Gatilho | Quando dispara | Status da cobrança |
|---|---|---|
| `BEFORE_DUE` | `diffDays == automation_days_before` | PENDING |
| `ON_DUE` | `diffDays == 0` | PENDING |
| `OVERDUE` | `diffDays == -automation_days_after` | OVERDUE |

## Anti-spam

Antes de enviar, verifica se já existe `MessageHistory` hoje com o mesmo `charge_id` e `trigger_type`. Se sim, pula. Um devedor não recebe o mesmo lembrete duas vezes no mesmo dia.

## Opt-out

O devedor pode responder "PARAR" via WhatsApp → webhook Z-API recebe → `User.whatsapp_opted_out = true` → não recebe mais automações.

Endpoint: `POST /webhooks/zapi/message` (`ZapiWebhookModule`)

## Variáveis nos Templates

| Variável | Substituída por |
|---|---|
| `{{nome}}` | `debtor.name` |
| `{{valor}}` | Valor formatado (R$ XX,XX) |
| `{{vencimento}}` | Data formatada (DD/MM/YYYY) |
| `{{chave_pix}}` | `creditor_profile.pix_key` |

## Conversão de Fuso Horário (Ponto Crítico)

```typescript
// src/automation/automation.service.ts
getBRTHour(): number {
  return new Date(
    new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }),
  ).getHours();
}
```

**⚠️ Risco crítico:** Bug aqui quebra **todos** os envios automáticos. Sempre testar com horário UTC próximo à meia-noite quando BRT = dia diferente.

## Riscos e Cuidados

- **Timezone** — o CRON roda em UTC; a conversão para BRT é crítica. Qualquer alteração em `getBRTHour()` pode quebrar todos os envios.
- **Plano FREE** não recebe automações — verificado na query do CRON (`plan_type IN (STARTER, PRO, UNLIMITED)`)
- **Z-API não configurada** — se `zapi_instance_id` for null, o envio usa credenciais globais ou falha silenciosamente. Verificar `WhatsAppService`.
- **Throttle Z-API** — envios em bulk têm delay de 1-2s entre mensagens para evitar ban do número
- **Falha em um envio não para os outros** — cada envio é independente; erros são registrados em `MessageHistory`
