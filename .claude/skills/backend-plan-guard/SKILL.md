---
name: backend-plan-guard
description: Controle de acesso por plano no back-end RecebeFácil — PlanGuard, PLAN_MODULES, limites de cobranças e recorrências por plano.
when_to_use: Quando implementar bloqueio de acesso por plano, verificar limite de cobranças, restringir recorrências, adicionar novo módulo ou implementar bulk actions restritas.
---

## Arquivos

```
src/common/plan-modules.ts              ← PLAN_MODULES, canAccessModule(), TEMPLATE_LIMITS
src/common/plan.guard.ts                ← PlanGuard (CanActivate)
src/common/requires-module.decorator.ts ← @RequiresModule('FINANCE')
```

## PLAN_MODULES — Fonte da Verdade (valores reais do código)

```ts
export const PLAN_MODULES: Record<PlanType, string[]> = {
  FREE:      ['HOME', 'CHARGES'],
  STARTER:   ['HOME', 'CHARGES', 'CLIENTS', 'EXCEL_IMPORT', 'CUSTOM_TEMPLATES'],
  PRO:       ['HOME', 'CHARGES', 'CLIENTS', 'EXCEL_IMPORT', 'CUSTOM_TEMPLATES', 'FINANCE', 'RECURRENCE'],
  UNLIMITED: ['HOME', 'CHARGES', 'CLIENTS', 'REPORTS', 'EXCEL_IMPORT', 'CUSTOM_TEMPLATES', 'FINANCE', 'RECURRENCE'],
};
```

**Diferenças críticas:**
- `REPORTS` → apenas UNLIMITED
- `FINANCE` e `RECURRENCE` → apenas PRO e UNLIMITED
- `STARTER` não tem acesso a FINANCE nem RECURRENCE

Qualquer novo módulo → adicionar aqui **primeiro**, antes de criar o controller.

## TEMPLATE_LIMITS

```ts
export const TEMPLATE_LIMITS: Record<PlanType, number | null> = {
  FREE:      0,     // Não pode salvar templates customizados
  STARTER:   3,     // Máximo 3 templates
  PRO:       null,  // Ilimitado
  UNLIMITED: null,
};
```

Validado via `canSaveMoreTemplates(plan, currentCount)` no MessageTemplateService.

## PlanGuard — Lógica Real

```ts
// src/common/plan.guard.ts
async canActivate(context): Promise<boolean> {
  const requiredModule = this.reflector.getAllAndOverride<string>(MODULE_KEY, [
    context.getHandler(), context.getClass(),
  ]);
  if (!requiredModule) return true; // sem decorator = acesso livre

  const userId = request.user?.id;
  if (!userId) throw new ForbiddenException('Usuário não autenticado.');

  const subscription = await this.prisma.subscription.findUnique({
    where: { user_id: userId },
  });

  // Sem assinatura OU status !== ACTIVE → FREE
  // OVERDUE, PAUSED, CANCELED, INACTIVE, PENDING = todos viram FREE
  const plan = subscription?.plan_type ?? PlanType.FREE;
  const effectivePlan = subscription?.status === 'ACTIVE' ? plan : PlanType.FREE;

  if (!canAccessModule(effectivePlan, requiredModule)) {
    throw new ForbiddenException(
      `Seu plano atual (${effectivePlan}) não tem acesso a este módulo. Faça upgrade para continuar.`
    );
  }

  request.userPlan = effectivePlan; // disponível no controller
  return true;
}
```

## Uso Correto no Controller

```ts
// PlanGuard NÃO é global — declarar explicitamente por controller/método
@UseGuards(PlanGuard)
@RequiresModule('FINANCE')
@Post('finance/withdraw')
async withdraw(@Req() req: Request, @Body() dto: WithdrawDto) {
  // req.userPlan disponível após PlanGuard executar
  return this.service.requestWithdrawal(req.user.id, dto);
}
```

## Limites de Cobranças (ChargesService)

```ts
const CHARGE_LIMITS = { FREE: 10, STARTER: 50, PRO: 200, UNLIMITED: 999999 };

const count = await this.prisma.charge.count({
  where: { creditor_id: userId, created_at: { gte: startOfMonth(new Date()) } },
});
if (count >= CHARGE_LIMITS[effectivePlan]) {
  throw new ForbiddenException('Limite mensal de cobranças atingido para seu plano.');
}
```

## Recorrências por Plano (valores reais)

```ts
const ALLOWED_RECURRENCES = {
  FREE:      [],                                  // sem recorrência
  STARTER:   ['MONTHLY'],                         // apenas mensal
  PRO:       ['WEEKLY', 'MONTHLY', 'YEARLY'],
  UNLIMITED: ['WEEKLY', 'MONTHLY', 'YEARLY'],
};
```

## Bulk Actions

```ts
// PRO e UNLIMITED: verificação manual no service
const subscription = await this.prisma.subscription.findUnique({ where: { user_id: userId } });
const effectivePlan = subscription?.status === 'ACTIVE' ? subscription.plan_type : 'FREE';

if (!['PRO', 'UNLIMITED'].includes(effectivePlan)) {
  throw new ForbiddenException('Ações em massa requerem plano PRO ou superior.');
}
```

## Resposta do GET /subscription/status

```ts
{
  plan: effectivePlan,
  status: subscription?.status ?? 'FREE',
  allowed_modules: PLAN_MODULES[effectivePlan], // front usa para montar menu
}
```

## Anti-patterns

- Nunca copiar PLAN_MODULES em outro arquivo — importar de `common/plan-modules.ts`
- Nunca usar `plan === 'PRO' || plan === 'UNLIMITED'` inline — usar `canAccessModule()`
- Nunca assumir que STARTER tem FINANCE — não tem (erro comum)
- Nunca assumir que PRO tem REPORTS — não tem (só UNLIMITED)
- Nunca usar `PAST_DUE` — o enum real é `OVERDUE`
- Nunca verificar plano no controller — sempre via PlanGuard ou service
