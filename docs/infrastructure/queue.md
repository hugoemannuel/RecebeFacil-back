# Filas: pg-boss

**Serviço:** `src/queue/pg-boss.service.ts`  
**Tecnologia:** [pg-boss](https://github.com/timgit/pg-boss) — fila persistente via PostgreSQL

## Por que pg-boss?

Usa o mesmo `DATABASE_URL` do Prisma — sem infraestrutura extra (sem Redis, RabbitMQ). Jobs são tabelas no PostgreSQL, com garantias de durabilidade e retry automático.

## Inicialização

`PgBossService` implementa `OnApplicationBootstrap` e `OnApplicationShutdown`:
- Boot: `boss.start()` → sinaliza `readyPromise`
- Shutdown: `boss.stop()` — graceful drain

Workers aguardam `pgBoss.ready()` antes de registrar handlers.

## Filas Configuradas

### `asaas-webhook` (WEBHOOK_ASAAS_QUEUE)

| Parâmetro | Valor |
|---|---|
| retryLimit | 5 |
| retryDelay | 30s |
| retryBackoff | true (exponencial) |
| deadLetter | `asaas-webhook-dlq` |

**Worker:** `AsaasWebhookWorker`  
**Job data:** `{ webhookEventId: string }`

Fluxo:
1. Controller salva `WebhookEvent` no banco
2. Enfileira `{ webhookEventId }` no pg-boss
3. Worker busca o evento, processa, marca `processed = true`
4. Falha → pg-boss retenta automaticamente (backoff exponencial)
5. Após 5 falhas → job vai para DLQ

### `whatsapp-notification` (NOTIFICATION_QUEUE)

| Parâmetro | Valor |
|---|---|
| retryLimit | 3 |
| retryDelay | 60s |
| retryBackoff | true |
| deadLetter | `whatsapp-notification-dlq` |

**Worker:** `NotificationWorker` (quando utilizado diretamente via fila)  
**Job data:** `{ chargeId: string, trigger: 'BEFORE_DUE' | 'ON_DUE' | 'OVERDUE' }`

## DLQ (Dead Letter Queue)

Jobs que excederam `retryLimit` vão para as DLQs:
- `asaas-webhook-dlq`
- `whatsapp-notification-dlq`

**CRON diário às 7h:** verifica DLQ do webhook Asaas.  
Se count > 5 → `AuditLog: WEBHOOK_DLQ_ALERT`

**⚠️ Não há alerta automático para o desenvolvedor** — verificar `AuditLog` ou o banco periodicamente.

## Como Inspecionar Manualmente

```sql
-- Ver jobs em processamento
SELECT * FROM pgboss.job WHERE name = 'asaas-webhook' AND state = 'active';

-- Ver jobs na DLQ
SELECT * FROM pgboss.job WHERE name = 'asaas-webhook-dlq';

-- Ver jobs com falha
SELECT * FROM pgboss.job WHERE state = 'failed';
```

## Como Reprocessar um Job da DLQ

1. Identificar o `webhookEventId` no payload do job
2. Verificar `WebhookEvent` no banco (campo `processed`, `retry_count`, `error`)
3. Se necessário, resetar: `UPDATE "WebhookEvent" SET processed = false, retry_count = 0 WHERE id = '...'`
4. Enfileirar novamente via código ou diretamente no banco

## Riscos e Cuidados

- **pg-boss é o único mecanismo de retry** — se ele cair no momento exato de receber um webhook e antes de salvar o job, o evento pode ser perdido. Mitigação: o controller salva `WebhookEvent` no banco **antes** de enfileirar.
- **Um job sem handler registrado** fica em estado `created` indefinidamente — sempre verificar se o worker subiu corretamente no boot
- **`DATABASE_URL` compartilhado** — pg-boss cria tabelas próprias no schema `pgboss`. Não deletar essas tabelas.
