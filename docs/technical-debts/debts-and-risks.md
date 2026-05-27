# Débitos Técnicos e Riscos

## Débitos Técnicos Ativos

### 1. Preços de Planos Hardcoded

**Localização:** `src/subscription/subscription.service.ts`  
**Risco:** Médio — mudança de preço exige novo deploy  
**Solução proposta:** Criar tabela `PlanPrice` no banco com `plan_type`, `period`, `price_cents`, `is_active`

---

### 2. Taxa de Split Parcialmente Hardcoded

**Localização:** `src/integrations/integrations.service.ts`  
**Risco:** Médio — taxa PRO=2% e UNLIMITED=1% estão no código  
**Situação:** `SplitTerm` existe no schema com `platform_fee_pct` mas não é lida em todos os fluxos  
**Solução proposta:** Ler `SplitTerm.platform_fee_pct` na criação de cobrança intermediada

---

### 3. ReportsModule Não Implementado

**Localização:** `src/reports/`  
**Risco:** Baixo — módulo registrado no `AppModule` mas é stub vazio  
**Impacto:** UNLIMITED tem acesso ao módulo REPORTS mas não há funcionalidade  
**Solução proposta:** Implementar ou remover do `AppModule` até implementar

---

### 4. Intermediados sem Reconciliação

**Localização:** `src/integrations/`  
**Risco:** Alto — cobranças `is_intermediated = true` com `status = PENDING` podem ficar em estado zumbi  
**Situação:** Fase 4 do plano de implementação (pendente)  
**Solução proposta:** CRON semanal verificando cobranças intermediadas PENDING > 48h sem webhook

---

### 5. Validação CPF/CNPJ apenas no Front-end

**Localização:** `src/subscription/` (checkout)  
**Risco:** Médio — CPF/CNPJ inválido chega ao Asaas e causa erro 400  
**Solução proposta:** Adicionar decorator `@IsCPFOrCNPJ()` no DTO usando `class-validator-cpf-cnpj`

---

### 6. Enum de Ações do AuditLog como String

**Localização:** `src/` (vários services)  
**Risco:** Baixo — valores como `'CHARGE_SENT'`, `'SUBSCRIPTION_ACTIVATED'` espalhados como strings  
**Solução proposta:** Criar `enum AuditAction` em `src/common/audit.types.ts`

---

### 7. Módulos sem Cobertura de Testes

**Localização:** `src/whatsapp/`, `src/profiles/`, `src/clients/`, `src/dashboard/`, `src/demo/`  
**Risco:** Médio — bugs em `WhatsAppService` afetam todos os envios automáticos  
**Solução proposta:** Criar specs para `WhatsAppService` e `DashboardService` com prioridade

---

## Riscos Arquiteturais

### 🔴 ENCRYPTION_KEY Perdida

**Módulo:** `src/common/crypto.service.ts`  
**Impacto:** Se `ENCRYPTION_KEY` for perdida ou trocada, todas as `asaas_account_key` no banco se tornam inacessíveis. Nenhum lojista consegue fazer saques ou criar cobranças intermediadas.  
**Mitigação:** Fazer backup seguro da chave fora do código/banco. Nunca rotacionar sem migração de dados.

---

### 🔴 pg-boss Fora do Ar no Momento do Webhook

**Módulo:** `src/queue/`  
**Cenário:** Asaas envia `PAYMENT_CONFIRMED`, controller salva `WebhookEvent`, mas falha ao enfileirar no pg-boss  
**Mitigação atual:** `WebhookEvent` já está salvo no banco — pode ser reenfileirado manualmente  
**Recomendação:** Adicionar verificação periódica de `WebhookEvent` não processados (sem `processed = true` após 30 min)

---

### ⚠️ current_period_end Divergente

**Módulo:** `src/subscription/`  
**Cenário:** `current_period_end` calculado localmente pode diferir do período real no Asaas  
**Mitigação atual:** CRON de sync diário às 6h corrige divergências  
**Cuidado:** Não usar `current_period_end` para decisões críticas sem verificar com o Asaas

---

### ⚠️ CRON de Timezone

**Módulo:** `src/automation/`  
**Cenário:** Bug em `getBRTHour()` → todos os lembretes automáticos param de funcionar  
**Mitigação:** Testar especificamente com horários UTC próximos à virada de dia  
**Cuidado:** Não alterar a lógica de conversão sem teste completo

---

## Cuidados ao Alterar Módulos Críticos

### `IntegrationsService.requestWithdrawal()`

- **Não alterar a ordem:** transação Prisma → Asaas fora da transação
- **Não mover a criação do `WithdrawalRecord` para depois** da chamada Asaas — perde proteção contra concorrência
- Qualquer alteração exige teste com cenários: saldo insuficiente, idempotência, timeout de rede

### `AsaasWebhookController.handleWebhook()`

- O controller **sempre** responde 200 — nunca deixar o processamento ser síncrono
- Fingerprint SHA-256 deve ser computado antes de salvar — nunca após
- Se mudar o algoritmo de fingerprint, todos os eventos históricos ficam "novos" (reprocessamento em massa)

### `AutomationService.handleDailyBillingSync()`

- `getBRTHour()` é o ponto mais sensível — alteração causa silêncio total dos lembretes
- `markOverdueCharges()` tem `is_intermediated: false` no WHERE — intencional, não remover
- Anti-spam depende de `MessageHistory` — limpar essa tabela em dev pode causar spam acidental

### `CryptoService`

- IV deve ser gerado aleatoriamente a cada encriptação — nunca reutilizar
- Mudar o formato de armazenação (`iv:authTag:cipher`) quebra todos os valores existentes no banco
- Mínimo 15 testes unitários — qualquer alteração deve manter cobertura de 95%

### `PlanGuard`

- `effectivePlan = FREE` para qualquer status diferente de `ACTIVE` — nunca relaxar essa regra
- Injetar `req.userPlan` é usado por alguns controllers — não remover
- `PrismaService` é injetado diretamente no guard — não criar dependência circular

---

## Próximas Melhorias Prioritárias

1. **Reconciliação de intermediados** — CRON semanal (Fase 4)
2. **Preços em tabela do banco** — `PlanPrice`
3. **Validação CPF/CNPJ no back-end** — `class-validator`
4. **Logs estruturados** — substituir `console.log` por `Logger`
5. **Health check real** — verificar PostgreSQL, pg-boss, Asaas
6. **Alert de DLQ** — canal real (email/Slack), não só `AuditLog`
7. **Specs faltantes** — `WhatsAppService`, `DashboardService`
