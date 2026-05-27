# Fluxo: Cobrança Intermediada (Split de Pagamento)

**Módulo:** `src/charges/` + `src/integrations/`  
**Requer plano:** PRO ou UNLIMITED  
**Requer:** `split_terms_accepted_at` preenchido em `IntegrationConfig`

## Visão Geral

Cobrança intermediada usa o **split automático do Asaas**: o devedor paga via link Asaas, a plataforma retém sua taxa e o lojista recebe o restante diretamente na sub-conta.

Diferente da cobrança PIX direto, o status de pagamento é atualizado **apenas via webhook Asaas** — não pelo lojista.

## Pré-requisitos

1. Lojista com plano PRO ou UNLIMITED
2. Sub-conta Asaas configurada (`asaas_wallet_id` preenchido)
3. Termos de split aceitos (`split_terms_accepted_at` não nulo)

## Fluxo Detalhado

```
1. POST /charges
   Body: {
     ...,
     is_intermediated: true,
     debtorPhone: "5511999999999",
     debtorName: "João Silva"
   }
        │
        ▼
2. ChargesService.createCharge()
   → Validar plano (PRO ou UNLIMITED)
   → Validar split_terms_accepted_at
   → Criar/encontrar Shadow User para o devedor
   → Criar Charge local com is_intermediated = true
        │
        ▼
3. AsaasService.createIntermediatedPayment({
     debtorName, debtorPhone,
     amount, dueDate, description,
     chargeId (externalReference),
     walletId (sub-conta do lojista),
     platformFeePct (PRO=2%, UNLIMITED=1%)
   })
        │
        ▼
4. No Asaas:
   4a. Criar/encontrar Customer devedor no Asaas
   4b. Criar Payment com split:
       - Lojista recebe: (100 - platformFeePct)%
       - Plataforma retém: platformFeePct%
       - Retorna: { id, invoiceUrl }
        │
        ▼
5. UPDATE Charge:
   - asaas_payment_id = payment.id
   - asaas_invoice_url = payment.invoiceUrl
   - platform_fee_pct = platformFeePct
        │
        ▼
6. Retornar charge com asaas_invoice_url para o front-end
   → Front exibe link de pagamento para o devedor
        │
        ▼
═══════════════════════════════════════════════
7. Devedor paga via link Asaas
        │
        ▼
8. Webhook PAYMENT_CONFIRMED
   { event: 'PAYMENT_CONFIRMED', payment: { id, externalReference, ... } }
        │
        ▼
9. AsaasWebhookWorker.dispatch('PAYMENT_CONFIRMED', payload)
   → Buscar Charge pelo asaas_payment_id (index) ou externalReference
   → UPDATE Charge:
     - status: PAID
     - payment_date: now()
   → AuditLog: CHARGE_PAID_INTERMEDIATED
```

## Taxas

| Plano | Taxa plataforma | Lojista recebe |
|---|---|---|
| PRO | 2% | 98% do valor |
| UNLIMITED | 1% | 99% do valor |

As taxas do Asaas (gateway) são descontadas adicionalmente pelo próprio Asaas (ver `docs/payments/split-payments.md`).

## Diferença: PIX Direto vs. Intermediado

| Aspecto | PIX Direto | Intermediado |
|---|---|---|
| Cobrança gerada | Localmente | No Asaas |
| Link de pagamento | QR Code do lojista | `asaas_invoice_url` |
| Confirmação de pagamento | Manual pelo lojista | Webhook automático |
| Planos | Todos | PRO e UNLIMITED |
| Marcação OVERDUE | CRON automático | Não marcado pelo CRON (is_intermediated = false no WHERE) |

## Riscos e Cuidados

- **🔴 Intermediados não são marcados OVERDUE pelo CRON** — o `markOverdueCharges()` tem `is_intermediated: false` no WHERE. Estado de atraso fica com o Asaas.
- **Reconciliação pendente (Fase 4)** — cobranças intermediadas PENDING > 48h sem webhook precisam ser verificadas manualmente no painel Asaas
- **`walletId` não é validado antes de intermediar** — se a sub-conta não estiver ativa no Asaas, o request falha na hora
- **Taxa hardcoded** — PRO=2%, UNLIMITED=1% estão no código; `SplitTerm` existe no schema mas não é lida para taxa da plataforma
