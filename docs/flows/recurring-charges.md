# Fluxo: Cobranças Recorrentes

**Módulo:** `src/automation/`  
**Serviço:** `AutomationService.handleRecurringChargeGeneration()`  
**Requer plano:** PRO ou UNLIMITED (`@RequiresModule('RECURRENCE')`)

## Visão Geral

Regras de recorrência definem que cobranças sejam geradas automaticamente em datas futuras. O CRON roda à meia-noite e cria as cobranças do dia.

## Frequências por Plano

| Plano | Frequências permitidas |
|---|---|
| FREE | Não tem acesso (ONCE apenas via cobrança manual) |
| STARTER | MONTHLY |
| PRO | WEEKLY, MONTHLY, YEARLY |
| UNLIMITED | WEEKLY, MONTHLY, YEARLY |

## Estrutura de Dados

**RecurringCharge** define a regra:
- `amount`, `frequency`, `description`
- `next_generation_date` — próxima data de geração
- `active` — se a regra está ativa
- `max_installments` — limite de cobranças (null = sem limite)

**RecurringChargeDebtor** — lista de devedores associados à regra (N:N).

## CRON: Geração de Recorrências

**Horário:** `0 0 * * *` (meia-noite UTC)  
**Arquivo:** `src/automation/automation.service.ts`

```
1. Buscar RecurringCharge ativas com next_generation_date <= hoje
        │
        ▼
2. Para cada regra:
   a. Verificar max_installments:
      - charges_count >= max_installments → SET active = false → próxima regra
   b. Para cada debtor na regra:
      - CREATE Charge:
        - creditor_id = rule.creditor_id
        - debtor_id = debtor.id
        - amount = rule.amount
        - due_date = rule.next_generation_date
        - status = PENDING
        - recurring_charge_id = rule.id
   c. Calcular próxima data:
      - WEEKLY:  +7 dias
      - MONTHLY: +1 mês
      - YEARLY:  +1 ano
   d. UPDATE RecurringCharge.next_generation_date = próxima data
```

## Endpoints de Gestão

```
GET    /charges/recurring           → Listar regras do lojista
GET    /charges/recurring/:id       → Detalhes de uma regra
POST   /charges/recurring/:id/cancel     → Desativar regra (active = false)
POST   /charges/recurring/:id/reactivate → Reativar regra
PATCH  /charges/recurring/:id       → Editar regra
```

## Criação de Regra

```
POST /charges
Body: {
  ...,
  recurrence: {
    frequency: 'MONTHLY',
    nextGenerationDate: '2026-06-01',
    maxInstallments: 12,
    debtorIds: ['uuid1', 'uuid2']
  }
}
```

## Cálculo de Próxima Data

```typescript
// src/automation/automation.service.ts
private calcNextDate(from: Date, frequency: string): Date {
  const d = new Date(from);
  if (frequency === 'WEEKLY')       d.setDate(d.getDate() + 7);
  else if (frequency === 'MONTHLY') d.setMonth(d.getMonth() + 1);
  else if (frequency === 'YEARLY')  d.setFullYear(d.getFullYear() + 1);
  return d;
}
```

**⚠️ Cuidado com meses:** `setMonth(1 + 1)` em 31 de janeiro resulta em 3 de março (mês de fevereiro não tem 31 dias). Comportamento nativo do JavaScript.

## Riscos e Cuidados

- **CRON roda em UTC** — `next_generation_date` deve ser armazenada sem componente de hora (meia-noite UTC) para evitar geração no dia errado
- **Falha em uma regra não para as outras** — o loop usa `try/catch` por regra
- **Não há retry de geração** — se o CRON falhar para uma regra, a próxima execução só acontece após 24h. Verificar logs se houver cobranças faltando.
- **Devedores removidos da regra** não têm cobranças canceladas retroativamente
