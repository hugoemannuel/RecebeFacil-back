# Notificações WhatsApp

**Serviço:** `src/whatsapp/whatsapp.service.ts`  
**Templates padrão:** `src/common/system-templates.ts`  
**Templates customizados:** `MessageTemplate` no banco

## Gatilhos de Envio

| Gatilho | Quando | Condição na cobrança |
|---|---|---|
| `BEFORE_DUE` | X dias antes do vencimento | status = PENDING |
| `ON_DUE` | No dia do vencimento | status = PENDING |
| `OVERDUE` | X dias após vencimento | status = OVERDUE |
| `MANUAL` | Disparado pelo lojista | qualquer status |

`X` é configurado por lojista em `IntegrationConfig.automation_days_before/after`.

## Templates

### Hierarquia de Seleção

1. Template customizado do lojista (`MessageTemplate` com `trigger` correspondente e `is_default = true`)
2. Template padrão do sistema (`src/common/system-templates.ts`)

### Variáveis Disponíveis

| Variável | Substituída por |
|---|---|
| `{{nome}}` | `debtor.name` |
| `{{valor}}` | Valor formatado (ex: R$ 150,00) |
| `{{vencimento}}` | Data formatada (ex: 01/06/2026) |
| `{{chave_pix}}` | `creditor_profile.pix_key` |

### Limites de Templates por Plano

| Plano | Templates customizados |
|---|---|
| FREE | 0 (só usa templates padrão) |
| STARTER | 3 |
| PRO | ilimitado |
| UNLIMITED | ilimitado |

Validado em `canSaveMoreTemplates()` (`src/common/plan-modules.ts`).

## MessageHistory

Cada envio (bem-sucedido ou não) gera um registro:

```typescript
await prisma.messageHistory.create({
  data: {
    charge_id: charge.id,
    trigger_type: TriggerType.AUTO_REMINDER_BEFORE,
    status: 'SENT',           // ou 'FAILED'
    zapi_message_id: 'abc123', // ID retornado pela Z-API
    error_details: null,       // Preenchido em caso de falha
  }
});
```

**Anti-spam:** antes de enviar, verifica se já há `MessageHistory` hoje com mesmo `charge_id` e mesmo tipo de trigger.

## Disparo Manual

`POST /charges/:id/notify`

```json
{
  "trigger": "MANUAL",
  "customMessage": "Texto opcional customizado para este envio"
}
```

Cria `MessageHistory` com `trigger_type = MANUAL`.

## Opt-out

- Campo: `User.whatsapp_opted_out = true`
- Ativado quando: devedor responde "PARAR" ao número do lojista
- Desativado quando: lojista ou devedor solicita reativação (sem endpoint ainda)
- Filtrado em: `AutomationService` antes de qualquer envio automático

## Configuração por Lojista

Campos relevantes em `IntegrationConfig`:

```
allows_automation   → master switch
zapi_instance_id    → ID da instância Z-API
zapi_instance_token → Token da instância Z-API
send_hour           → Hora de envio (BRT)
automation_days_before → Dias antes do vencimento
automation_days_after  → Dias após vencimento
allow_before_due    → Liga/desliga BEFORE_DUE
allow_on_due        → Liga/desliga ON_DUE
allow_overdue       → Liga/desliga OVERDUE
```
