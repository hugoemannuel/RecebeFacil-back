# Gateway de Pagamento e Monetização - RecebeFácil

Este documento detalha toda a estratégia de monetização do RecebeFácil, a integração com o gateway **Asaas** e o planejamento da feature futura de split de pagamentos.

---

## 1. Visão Geral da Monetização

O RecebeFácil cobra uma assinatura mensal ou anual dos lojistas (credores) para usar a plataforma. O gateway oficial para processar essas cobranças é o **Asaas** (`https://www.asaas.com/` | Docs: `https://docs.asaas.com/`).

### Planos e Preços

| Plano    | Mensal    | Anual (desconto ~20%) | Módulos                                                       |
|----------|-----------|-----------------------|---------------------------------------------------------------|
| FREE     | R$ 0      | R$ 0                  | Home, Cobranças (até 10/mês)                                  |
| STARTER  | R$ 29/mês | R$ 278/ano            | Home, Cobranças (até 50/mês), Clientes, Relatórios, Excel     |
| PRO      | R$ 69/mês | R$ 662/ano            | Todos os módulos, cobranças ilimitadas, automação completa     |

---

## 2. Integração com o Asaas (MVP)

### 2.1. Modelo de Implementação (NestJS)

Criar um `SubscriptionModule` com as seguintes responsabilidades:

```
back-end/src/subscription/
  subscription.module.ts
  subscription.controller.ts   → Rotas: POST /subscription/checkout, GET /subscription/status
  subscription.service.ts      → Lógica de criação de customer + payment link no Asaas
  webhook.controller.ts        → POST /webhooks/asaas
```

### 2.2. Fluxo de Assinatura

```
1. Lojista escolhe um plano e clicla em "Assinar"
        ↓
2. Front-end chama: POST /subscription/checkout { planType, period: 'MONTHLY' | 'YEARLY' }
        ↓
3. Back-end verifica se o lojista já tem um Customer ID no Asaas
   - Se não tiver: POST https://www.asaas.com/api/v3/customers { name, email, cpfCnpj? }
   - Salva o asaas_customer_id no banco (campo a adicionar no modelo User)
        ↓
4. Back-end cria uma cobrança no Asaas:
   POST https://www.asaas.com/api/v3/payments
   { customer: asaas_customer_id, value: 29.00, dueDate: ..., billingType: 'UNDEFINED' }
   → billingType: 'UNDEFINED' permite que o cliente escolha Pix, Boleto ou Cartão
        ↓
5. Asaas retorna { invoiceUrl: 'https://...' } → enviamos para o front-end
        ↓
6. Front-end redireciona para o invoiceUrl (checkout hospedado no Asaas)
        ↓
7. Cliente paga → Asaas dispara um webhook para POST /webhooks/asaas
        ↓
8. Back-end valida a assinatura do webhook, atualiza o Subscription no banco
```

### 2.3. Variáveis de Ambiente Necessárias

```env
ASAAS_API_KEY=             # Chave da API do Asaas (sandbox ou produção)
ASAAS_WEBHOOK_SECRET=      # Secret para validar os webhooks recebidos
ASAAS_API_URL=https://www.asaas.com/api/v3   # Trocar por sandbox em dev
```

> ⚠️ **NUNCA** commitar essas chaves no repositório. Usar `.env` (no .gitignore) em local e variáveis de ambiente seguras em produção (ex: AWS Secrets Manager, Railway ENV).

### 2.4. Segurança do Webhook (Crítico)

Conforme `security-guidelines.md` Seção 5, toda chamada para `/webhooks/asaas` deve ser validada:

```typescript
// webhook.controller.ts
@Post('/webhooks/asaas')
async handleAsaasWebhook(@Req() req: Request, @Headers('asaas-access-token') token: string) {
  if (token !== process.env.ASAAS_WEBHOOK_SECRET) {
    throw new UnauthorizedException('Webhook inválido.');
  }
  // processar o evento com idempotência
  const event = req.body;
  await this.subscriptionService.handleWebhookEvent(event);
}
```

**Eventos a tratar:**
- `PAYMENT_CONFIRMED` → Ativar/manter plano (verificar se já ativo antes de atualizar).
- `PAYMENT_OVERDUE` → Marcar assinatura como `PAST_DUE`.
- `PAYMENT_DELETED` / `PAYMENT_REFUNDED` → Cancelar assinatura → rebaixar para FREE.

### 2.5. Campos a Adicionar no Schema do Prisma (MVP)

```prisma
model User {
  // ...campos existentes...
  asaas_customer_id  String?  // ID do cliente no Asaas
}

model Subscription {
  // ...campos existentes...
  period           SubPeriod // MONTHLY, YEARLY
  asaas_payment_id String?   // ID da última cobrança no Asaas (para idempotência)
}

enum SubPeriod {
  MONTHLY
  YEARLY
}
```

---

## 3. Feature Futura: Split de Pagamentos (Plataforma de Cobrança)

> 🔭 **Esta seção é um planejamento para uma versão futura do produto (pós-MVP).** O banco de dados deve ser preparado para isso, mas a implementação não é prioridade agora.

### 3.1. A Visão

Em vez de apenas enviar mensagens de cobrança via WhatsApp, o RecebeFácil poderá **ser o intermediador do pagamento**: o pagador paga diretamente pela plataforma (via link gerado pelo Asaas) e o dinheiro é repassado automaticamente para a conta do lojista, **descontando 1% de taxa de serviço** para o RecebeFácil.

### 3.2. Mecanismo no Asaas (Split de Pagamento)

O Asaas suporta nativamente a funcionalidade de "split" (divisão de pagamento). Na criação da cobrança:

```json
{
  "customer": "cus_LOJISTA_ID",
  "value": 100.00,
  "billingType": "UNDEFINED",
  "split": [
    {
      "walletId": "WALLET_ID_DO_RECEBEFACIL",
      "fixedValue": 1.00
    }
  ]
}
```

Isso faz o Asaas, automaticamente, reter R$ 1,00 (1%) para a carteira do RecebeFácil e repassar R$ 99,00 para o lojista.

### 3.3. Pré-requisitos Técnicos (Para o banco estar pronto agora)

Adicionar ao schema do Prisma (pode fazer agora como preparação):

```prisma
model User {
  // ...
  asaas_wallet_id    String?  // ID da sub-conta/carteira do lojista no Asaas (Asaas Connect)
  asaas_account_key  String?  // Chave de acesso da conta do lojista (Asaas Connect)
}

model Charge {
  // ...
  asaas_payment_id   String?  // ID da cobrança no Asaas (quando o lojista usar intermediação)
  platform_fee_pct   Decimal? // % de taxa cobrada pelo RecebeFácil (default: 1.00)
  is_intermediated   Boolean  @default(false) // Se a cobrança usa intermediação da plataforma
}
```

### 3.4. Fluxo Futuro (Onboarding do Lojista como Sub-Conta no Asaas)

Para que o split funcione, o lojista precisa ter uma sub-conta no Asaas (Asaas Connect):
1. Lojista preenche dados da conta bancária no RecebeFácil.
2. Back-end registra uma sub-conta no Asaas via `POST /mySubAccounts`.
3. Asaas retorna um `walletId` — guardamos em `User.asaas_wallet_id`.
4. A partir daí, cobranças com `is_intermediated = true` incluem o campo `split` na criação.

---

## 4. Segurança de Dados de Cartão de Crédito

> ⚠️ **Regra absoluta:** O RecebeFácil **NUNCA** deve armazenar dados de cartão de crédito (número, CVV, validade) em seus próprios servidores. **Isso é proibido pelo PCI DSS.**

*   Todo o processamento de cartão é feito pelo Asaas (que é certificado PCI DSS).
*   O front-end pode usar o **Asaas.js** (biblioteca oficial do Asaas) para tokenizar o cartão direto no navegador do cliente, sem que o número trafegue pelos nossos servidores.
*   Nos logs, **NUNCA** logar dados de cartão. Se um erro acontecer, logar apenas o `asaas_payment_id`.
*   Para cobranças recorrentes automáticas via cartão, o Asaas gerencia o token internamente — apenas salvamos o `asaas_payment_id` da assinatura.
