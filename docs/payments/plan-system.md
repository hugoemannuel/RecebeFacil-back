# Sistema de Planos

**Arquivo de referência:** `src/common/plan-modules.ts`  
**Guard:** `src/common/plan.guard.ts`  
**Schema:** `Subscription` em `prisma/schema.prisma`

## Planos Disponíveis

| Plano | Cobranças/mês | Recorrências | Bulk actions | Templates | Split |
|---|---|---|---|---|---|
| FREE | 10 | — | ✗ | 0 | ✗ |
| STARTER | 50 | MONTHLY | ✗ | 3 | ✗ |
| PRO | 200 | WEEKLY, MONTHLY, YEARLY | ✓ | ilimitado | ✓ (2%) |
| UNLIMITED | 999.999 | WEEKLY, MONTHLY, YEARLY | ✓ | ilimitado | ✓ (1%) |

## Módulos por Plano

```typescript
// src/common/plan-modules.ts
export const PLAN_MODULES = {
  FREE:      ['HOME', 'CHARGES'],
  STARTER:   ['HOME', 'CHARGES', 'CLIENTS', 'EXCEL_IMPORT', 'CUSTOM_TEMPLATES'],
  PRO:       ['HOME', 'CHARGES', 'CLIENTS', 'EXCEL_IMPORT', 'CUSTOM_TEMPLATES', 'FINANCE', 'RECURRENCE'],
  UNLIMITED: ['HOME', 'CHARGES', 'CLIENTS', 'REPORTS', 'EXCEL_IMPORT', 'CUSTOM_TEMPLATES', 'FINANCE', 'RECURRENCE'],
};
```

**REPORTS** só está disponível no UNLIMITED — o módulo `ReportsModule` é um stub não implementado.

## Limites de Templates

```typescript
export const TEMPLATE_LIMITS = {
  FREE:      0,     // Não pode salvar nenhum template
  STARTER:   3,     // Máximo 3 templates
  PRO:       null,  // Ilimitado
  UNLIMITED: null,  // Ilimitado
};
```

Validado em `MessageTemplateService` via `canSaveMoreTemplates(plan, currentCount)`.

## Como Adicionar Novo Módulo

1. Adicionar string em `PLAN_MODULES` para os planos que devem ter acesso
2. Usar `@RequiresModule('NOME_DO_MODULO')` + `@UseGuards(PlanGuard)` no controller
3. Se tiver limite numérico, adicionar em constante similar a `TEMPLATE_LIMITS`

## Plano Efetivo

O `PlanGuard` sempre calcula o plano efetivo em tempo de requisição:

```typescript
const effectivePlan = subscription?.status === 'ACTIVE'
  ? subscription.plan_type
  : PlanType.FREE;
```

Planos com `status` diferente de `ACTIVE` são tratados como FREE, independente do `plan_type`.

## Verificação de Limite de Cobranças

Realizada em `ChargesService` antes de criar uma cobrança:

```typescript
const CHARGE_LIMITS = {
  FREE: 10, STARTER: 50, PRO: 200, UNLIMITED: 999999
};

const thisMonthCount = await prisma.charge.count({
  where: { creditor_id: userId, created_at: { gte: startOfMonth } }
});

if (thisMonthCount >= CHARGE_LIMITS[effectivePlan]) {
  throw new ForbiddenException('Limite mensal atingido para seu plano.');
}
```

## Períodos

| SubPeriod | Duração | `current_period_end` |
|---|---|---|
| MONTHLY | 1 mês | `now + 1 mês` |
| YEARLY | 1 ano | `now + 1 ano` |

## Status da Assinatura

| Status | Acesso |
|---|---|
| ACTIVE | Plano contratado |
| PENDING | Aguardando pagamento → FREE |
| OVERDUE | Em atraso (grace 4 dias) → FREE |
| PAUSED | Pausado → FREE |
| CANCELED | Cancelado → FREE |
| INACTIVE | Inativo → FREE |
