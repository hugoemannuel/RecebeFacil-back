---
name: backend-plan-guard
description: Controle de acesso por plano no back-end RecebeFácil — PlanGuard, PLAN_MODULES, limites de cobranças e recorrências por plano.
when_to_use: Quando implementar bloqueio de acesso por plano, verificar limite de cobranças, restringir recorrências, adicionar novo módulo ou implementar bulk actions restritas.
---

## Arquivos

```
src/common/plan-modules.ts           ← PLAN_MODULES, canAccessModule(), TEMPLATE_LIMITS
src/common/plan.guard.ts             ← PlanGuard (CanActivate)
src/common/requires-module.decorator.ts ← @RequiresModule('CLIENTS')
```

## PLAN_MODULES — Fonte da Verdade

```ts
export const PLAN_MODULES: Record<PlanType, string[]> = {
  FREE:      ['HOME', 'CHARGES'],
  STARTER:   ['HOME', 'CHARGES', 'CLIENTS', 'REPORTS', 'EXCEL_IMPORT', 'CUSTOM_TEMPLATES'],
  PRO:       ['HOME', 'CHARGES', 'CLIENTS', 'REPORTS', 'EXCEL_IMPORT', 'CUSTOM_TEMPLATES'],
  UNLIMITED: ['HOME', 'CHARGES', 'CLIENTS', 'REPORTS', 'EXCEL_IMPORT', 'CUSTOM_TEMPLATES'],
};

export function canAccessModule(plan: PlanType, module: string): boolean {
  return PLAN_MODULES[plan]?.includes(module) ?? false;
}
```

Qualquer novo módulo → adicionar aqui **primeiro**, antes de criar o controller.

## TEMPLATE_LIMITS

```ts
export const TEMPLATE_LIMITS: Record<PlanType, number | null> = {
  FREE:      0,     // não pode salvar templates customizados
  STARTER:   3,
  PRO:       null,  // ilimitado
  UNLIMITED: null,
};
```

## @RequiresModule Decorator

```ts
export const RequiresModule = (module: string) => SetMetadata(MODULE_KEY, module);

// Uso:
@Get()
@RequiresModule('CLIENTS')
async listClients(@Request() req) { ... }
```

## PlanGuard — Lógica

```ts
async canActivate(context): Promise<boolean> {
  const requiredModule = this.reflector.getAllAndOverride<string>(MODULE_KEY, [
    context.getHandler(), context.getClass(),
  ]);
  if (!requiredModule) return true;  // sem decorator = acesso livre

  const subscription = await this.prisma.subscription.findUnique({ where: { user_id: userId } });

  // PAST_DUE/CANCELED/ausente → trata como FREE
  const effectivePlan = subscription?.status === 'ACTIVE' ? subscription.plan_type : PlanType.FREE;

  if (!canAccessModule(effectivePlan, requiredModule)) {
    throw new ForbiddenException(`Plano ${effectivePlan} não tem acesso a este módulo.`);
  }

  request.userPlan = effectivePlan;  // disponível no controller
  return true;
}
```

## Uso Combinado no Controller

```ts
@Controller('clients')
@UseGuards(AuthGuard('jwt'), PlanGuard)
export class ClientsController {
  @Get()
  @RequiresModule('CLIENTS')
  async list(@Request() req) { ... }
}
```

## Limites de Cobranças (ChargesService)

```ts
const planLimits = { FREE: 10, STARTER: 50, PRO: 200, UNLIMITED: 999999 };
const chargeCount = await this.prisma.charge.count({
  where: { creditor_id: userId, created_at: { gte: startOfMonth } },
});
if (chargeCount >= planLimits[subscription.plan_type]) {
  throw new ForbiddenException('LIMIT_REACHED');
}
```

## Recorrências por Plano (ChargesService)

```ts
const allowedRecurrences = {
  FREE:      ['ONCE'],
  STARTER:   ['ONCE', 'WEEKLY'],
  PRO:       ['ONCE', 'WEEKLY', 'MONTHLY', 'YEARLY'],
  UNLIMITED: ['ONCE', 'WEEKLY', 'MONTHLY', 'YEARLY'],
};
if (!allowedRecurrences[subscription.plan_type]?.includes(dto.recurrence)) {
  throw new ForbiddenException('RECURRENCE_NOT_ALLOWED');
}
```

## Bulk Actions (verificação manual no service)

```ts
async bulkCancel(userId: string, chargeIds: string[]) {
  const subscription = await this.prisma.subscription.findUnique({ where: { user_id: userId } });
  if (!subscription || ['FREE', 'STARTER'].includes(subscription.plan_type)) {
    throw new ForbiddenException('Ações em massa requerem plano PRO ou superior.');
  }
  // ...
}
```

## Resposta para o Front-End

```ts
// GET /subscription/status retorna:
{
  plan,
  status,
  allowed_modules: PLAN_MODULES[plan],  // front-end usa para montar menu
}
```

## Anti-patterns

- Nunca verificar plano inline no controller — usar PlanGuard ou service
- Nunca duplicar lógica de PLAN_MODULES em outros arquivos — importar de `plan-modules.ts`
- Nunca usar `plan === 'PRO' || plan === 'UNLIMITED'` inline — usar `canAccessModule()`
- Nunca retornar mensagem técnica de 403 — mensagem de negócio legível
