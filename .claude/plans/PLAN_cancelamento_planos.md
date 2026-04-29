# Plano: Cancelamento de Plano + Acesso à Página de Planos para UNLIMITED

## Status
Backend completo. Apenas frontend restante.

## O que já está feito
- ✅ `subscription.service.ts` — cancelSubscription, recordPaymentFailure, clearPaymentFailure, cancelOverdueSubscriptions, getSubscriptionStatus retorna cancel_at_period_end/payment_failed/payment_failed_at/sentThisMonth
- ✅ `subscription.controller.ts` — POST /subscription/cancel, POST /subscription/retry-payment
- ✅ Prisma schema — payment_failed_at, payment_failure_reason
- ✅ `app/actions/subscription.ts` — cancelSubscriptionAction adicionada
- ✅ `app/planos/page.tsx` — card UNLIMITED adicionado, grid 4 colunas, PRO corrigido
- ✅ `DashboardLayout/interface/index.ts` — cancel_at_period_end, payment_failed, payment_failed_at na interface
- ✅ `DashboardLayout.tsx` — banner de falha de pagamento com dismiss

---

## Pendente (frontend)

### 1. Propagar campos novos — 3 page.tsx

**`app/dashboard/page.tsx`** (linha 61–67), **`app/dashboard/cobrancas/page.tsx`** (linha 43–49), **`app/dashboard/configuracoes/page.tsx`** (linha 22–28)

Em cada um, adicionar ao objeto `subscription`:
```ts
cancel_at_period_end: subscriptionData?.cancel_at_period_end ?? false,
payment_failed: subscriptionData?.payment_failed ?? false,
payment_failed_at: subscriptionData?.payment_failed_at ?? null,
```

### 2. planos/page.tsx — Botão cancelar + ConfirmModal

Arquivo: `front-end/app/planos/page.tsx`

Adicionar ao estado e carregar no `useEffect`:
```ts
const [cancelModalOpen, setCancelModalOpen] = useState(false);
const [cancelLoading, setCancelLoading] = useState(false);
const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false);
const [periodEnd, setPeriodEnd] = useState<string | null>(null);

// no loadStatus:
setCancelAtPeriodEnd(status.cancel_at_period_end ?? false);
setPeriodEnd(status.current_period_end ?? null);
```

Função de cancelar (usa `cancelSubscriptionAction` + `toast` from `sonner`):
```ts
async function handleCancel() {
  setCancelLoading(true);
  const result = await cancelSubscriptionAction();
  if (result.success) {
    setCancelAtPeriodEnd(true);
    toast.success('Plano cancelado. Acesso mantido até o fim do período.');
  } else {
    toast.error(result.error ?? 'Erro ao cancelar.');
  }
  setCancelLoading(false);
  setCancelModalOpen(false);
}
```

Lógica do botão do card (dentro do `.map`):
- `isCurrent && plan.id === 'FREE'` → disabled "Plano Atual"
- `isCurrent && cancelAtPeriodEnd` → disabled, label "Cancelamento agendado", classe amber
- `isCurrent && !cancelAtPeriodEnd && plan.id !== 'FREE'` → "Cancelar plano" → `setCancelModalOpen(true)`
- outros → fluxo de checkout normal

Badge abaixo do botão quando `isCurrent && cancelAtPeriodEnd && periodEnd`:
```tsx
<p className="text-xs text-amber-600 font-medium text-center mt-2">
  Acesso até {new Date(periodEnd).toLocaleDateString('pt-BR')}
</p>
```

ConfirmModal no final do componente:
```tsx
<ConfirmModal
  open={cancelModalOpen}
  title="Cancelar plano?"
  description={`Seu acesso continuará ativo até ${periodEnd ? new Date(periodEnd).toLocaleDateString('pt-BR') : 'o fim do período pago'}. Após isso, volta para FREE.`}
  confirmLabel="Sim, cancelar"
  variant="danger"
  loading={cancelLoading}
  onConfirm={handleCancel}
  onCancel={() => setCancelModalOpen(false)}
/>
```

Imports a adicionar: `ConfirmModal` de `@/components/ui/ConfirmModal`, `cancelSubscriptionAction` de `@/app/actions/subscription`, `toast` de `sonner`

### 3. ConfiguracoesClient.tsx — Botão "Gerenciar plano" + aviso cancelamento

Arquivo: `front-end/app/dashboard/configuracoes/ConfiguracoesClient.tsx`

Trocar o bloco atual (linha 304–311):
```tsx
{plan !== 'UNLIMITED' && (
  <Link href="/planos" className="block w-full text-center bg-green-500 ...">
    Fazer upgrade de plano →
  </Link>
)}
```

Por (FREE → upgrade verde, pagos → gerenciar cinza):
```tsx
{plan === 'FREE' ? (
  <Link href="/planos" className="block w-full text-center bg-green-500 hover:bg-green-600 text-white font-bold py-3.5 rounded-2xl transition-all shadow-lg shadow-green-500/20 hover:scale-[1.01]">
    Fazer upgrade de plano →
  </Link>
) : (
  <Link href="/planos" className="block w-full text-center bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-800 dark:text-zinc-200 font-bold py-3.5 rounded-2xl transition-all hover:scale-[1.01]">
    Gerenciar plano →
  </Link>
)}
```

Adicionar aviso de cancelamento agendado antes do botão:
```tsx
{subscription?.cancel_at_period_end && subscription.current_period_end && (
  <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-2xl p-4">
    <IconAlertOctagon className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
    <p className="text-sm text-amber-800 dark:text-amber-300">
      Cancelamento agendado. Acesso mantido até <strong>{new Date(subscription.current_period_end).toLocaleDateString('pt-BR')}</strong>.
    </p>
  </div>
)}
```

---

## Verificação
1. DashboardLayout mostra banner amber quando `payment_failed=true` (já funciona)
2. Plano UNLIMITED → aba Plano em Configurações → botão "Gerenciar plano →" visível
3. /planos → card UNLIMITED → botão "Cancelar plano" → ConfirmModal → confirmar
4. Após cancelar: badge "Acesso até DD/MM" aparece, botão vira "Cancelamento agendado" (disabled)
5. Aba Plano em Configurações → aviso laranja de cancelamento agendado
6. FREE em qualquer lugar → botão "Fazer upgrade de plano →"
