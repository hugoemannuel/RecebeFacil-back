# CRON Jobs

**Módulo:** `src/automation/`  
**Framework:** `@nestjs/schedule` com `@Cron()` decorator

## Lista de Jobs

### 1. Geração de Cobranças Recorrentes

| Campo | Valor |
|---|---|
| Schedule | `0 0 * * *` (meia-noite UTC) |
| Método | `AutomationService.handleRecurringChargeGeneration()` |
| Arquivo | `src/automation/automation.service.ts` |

**O que faz:**
- Busca `RecurringCharge` ativas com `next_generation_date <= hoje`
- Para cada regra: valida `max_installments`, cria `Charge` para cada devedor
- Avança `next_generation_date` para o próximo período
- Desativa regra ao atingir `max_installments`

---

### 2. Sincronização Horária (Lembretes + OVERDUE)

| Campo | Valor |
|---|---|
| Schedule | `0 * * * *` (toda hora cheia, UTC) |
| Método | `AutomationService.handleDailyBillingSync()` |
| Arquivo | `src/automation/automation.service.ts` |

**O que faz:**
1. Marca cobranças vencidas como OVERDUE (PIX direto apenas)
2. Verifica hora atual em BRT
3. Para credores com `send_hour` = hora atual: dispara lembretes WhatsApp

---

### 3. Verificação de Saques Presos

| Campo | Valor |
|---|---|
| Schedule | Diário às 8h UTC |
| Método | `IntegrationsService` ou serviço dedicado |
| Arquivo | `src/integrations/` |

**O que faz:**
- Busca `WithdrawalRecord` com `status = PROCESSING` há mais de 24h
- Cria `AuditLog: WITHDRAWAL_STUCK_ALERT`

---

### 4. Monitoramento da DLQ de Webhooks

| Campo | Valor |
|---|---|
| Schedule | Diário às 7h UTC |
| Método | `AsaasWebhookWorker.checkDlqHealth()` |
| Arquivo | `src/integrations/asaas-webhook.worker.ts` |

**O que faz:**
- Conta jobs na fila `asaas-webhook-dlq`
- Se count > 5 → `AuditLog: WEBHOOK_DLQ_ALERT`

---

### 5. Sincronização de Assinaturas PENDING

| Campo | Valor |
|---|---|
| Schedule | Diário às 6h UTC |
| Método | `SubscriptionService.syncPendingSubscriptions()` |
| Arquivo | `src/subscription/subscription.service.ts` |

**O que faz:**
- Busca `Subscription` com `status = PENDING` há mais de 1h
- Verifica status real no Asaas via `asaas_id`
- Corrige divergências (ex: Asaas ativo mas banco ainda PENDING)

## Erros nos CRON Jobs

Cada CRON usa `try/catch` e loga via `Logger`. Falha em um job não impacta os outros.

**Monitoramento:** verificar logs do Railway ou `AuditLog` no banco para detectar falhas recorrentes.

## Riscos e Cuidados

- **Fuso horário:** todos os CRON rodam em UTC. A conversão para BRT é feita manualmente em `getBRTHour()`. Bug aqui quebra todos os lembretes.
- **CRON de recorrências** roda à meia-noite UTC = 21h BRT (22h no horário de verão). Se um servidor reiniciar nessa janela, o job pode ser pulado.
- **Não há fila para CRON** — se um job falhar, não há retry automático. A próxima execução ocorre no próximo ciclo.
- **Cobranças recorrentes** geradas com erro ficam sem cobrança naquele período — verificar logs se devedores reportarem cobranças faltando.
