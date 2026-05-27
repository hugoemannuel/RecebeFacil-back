# Split de Pagamentos

**Módulo:** `src/integrations/`  
**Requer plano:** PRO ou UNLIMITED

## Visão Geral

O split permite que o lojista cobre seus clientes via link Asaas. O Asaas processa o pagamento e distribui automaticamente:
- Uma parcela para o lojista (sub-conta Asaas)
- Uma taxa para a plataforma RecebeFácil

O lojista **não precisa de conta bancária própria** — o dinheiro vai para a sub-conta Asaas dele.

## Onboarding do Lojista

### 1. Aceitar Termos

```
GET /integrations/asaas/split-terms
→ Retorna os termos vigentes + taxas

POST /integrations/asaas/acknowledge-split
→ Salva split_terms_accepted_at e split_terms_version
```

### 2. Verificar Status

```
GET /integrations/split-status
→ { accepted: boolean }
```

### 3. Criar Sub-conta no Asaas

Ocorre automaticamente no primeiro checkout de assinatura PRO/UNLIMITED (ou via endpoint dedicado).  
Salva `asaas_wallet_id` e `asaas_account_key` (criptografado) em `IntegrationConfig`.

## Taxas

### Taxa da Plataforma (RecebeFácil)

| Plano | Taxa | Lojista recebe |
|---|---|---|
| PRO | 2% | 98% |
| UNLIMITED | 1% | 99% |

**⚠️ Débito técnico:** taxa hardcoded no código. `SplitTerm.platform_fee_pct` existe no schema mas não é lida em todos os fluxos.

### Taxas do Gateway (Asaas)

Cobradas pelo Asaas sobre cada transação liquidada (independente da taxa da plataforma):

| Modalidade | Taxa |
|---|---|
| PIX | R$ 1,99/transação (100 primeiras do mês isentas) |
| Boleto | R$ 1,99/boleto pago |
| Cartão | 2,99% + R$ 0,49 |

Essas taxas são do Asaas e podem mudar. Verificar: asaas.com/precos-e-taxas.

## SplitTerm (Tabela de Taxas Dinâmicas)

```prisma
model SplitTerm {
  version         String   @unique  // Ex: '2.0.0'
  is_active       Boolean  @default(true)
  platform_fee_pct Decimal @default(1.0)
  ...
}
```

O `IntegrationsService` busca o `SplitTerm` ativo ao retornar termos ao front-end.  
**Limitação atual:** a taxa em `SplitTerm` não é lida dinamicamente no momento da criação da cobrança intermediada — está hardcoded.

## Estrutura do Split no Asaas

Ao criar uma cobrança intermediada, o `AsaasService` envia:

```json
{
  "customer": "cus_devedor_id",
  "value": 100.00,
  "dueDate": "2026-06-01",
  "externalReference": "charge_id_local",
  "split": [
    {
      "walletId": "wallet_lojista_id",
      "percentualValue": 98
    }
  ]
}
```

O Asaas retém os 2% restantes como taxa da plataforma.

## Acesso ao Saldo

```
GET /integrations/finance/balance
→ { balance: number, hasSubaccount: boolean }
```

Busca saldo real via `GET /finance/balance` no Asaas usando `asaas_account_key` descriptografado.

## Riscos e Cuidados

- **`asaas_account_key` criptografada** — perdendo `ENCRYPTION_KEY`, o lojista perde acesso à sub-conta via API
- **`walletId` não validado** antes de intermediar — se inválido, o Asaas retorna erro na criação da cobrança
- **Reconciliação pendente** — cobranças intermediadas PENDING sem atualização via webhook ficam em estado zumbi (ver `docs/technical-debts/debts-and-risks.md`)
- **Reversão de split** — o Asaas pode estornar o split automaticamente em chargebacks; não há handler implementado para esse evento
