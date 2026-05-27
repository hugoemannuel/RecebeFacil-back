# RecebeFácil — Documentação Técnica

> Documentação técnica do back-end. Reflete o estado atual do sistema.
> Última atualização: 2026-05-26

---

## Índice

### Arquitetura
- [Visão Geral](architecture/overview.md) — tech stack, decisões, componentes
- [Módulos](architecture/modules.md) — todos os módulos, responsabilidades, dependências
- [Ciclo de Vida de uma Requisição](architecture/request-lifecycle.md)

### Autenticação e Autorização
- [Auth, JWT, PlanGuard e IDOR](auth/auth-and-authorization.md)

### Banco de Dados
- [Schema Prisma](database/schema.md) — modelos, relações, enums, invariantes
- [Migrations](database/migrations.md) — histórico e como criar novas

### Fluxos de Negócio
- [Assinatura de Plano](flows/subscription.md) — checkout → webhook → ativação
- [Saque Seguro](flows/withdrawal.md) — idempotência, PIX, confirmação
- [Cobrança Intermediada](flows/intermediated-charge.md) — split Asaas
- [Cobranças Recorrentes](flows/recurring-charges.md) — geração por CRON
- [Automação WhatsApp](flows/whatsapp-automation.md) — CRON de lembretes

### Integrações Externas
- [Asaas](integrations/asaas.md) — endpoints, auth, webhooks, eventos
- [Z-API (WhatsApp)](integrations/zapi.md) — envio, opt-out, throttling

### Pagamentos e Planos
- [Sistema de Planos](payments/plan-system.md) — FREE/STARTER/PRO/UNLIMITED, limites
- [Split de Pagamentos](payments/split-payments.md) — taxas, SplitTerm, onboarding

### Notificações
- [WhatsApp](notifications/whatsapp.md) — templates, variáveis, MessageHistory

### Infraestrutura
- [Filas (pg-boss)](infrastructure/queue.md) — workers, retry, DLQ
- [CRON Jobs](infrastructure/cron-jobs.md) — todos os jobs, horários, lógica
- [Variáveis de Ambiente](infrastructure/environment.md)

### Segurança
- [Regras de Segurança](security/security-rules.md) — IDOR, rate limit, LGPD, o que nunca logar

### Padrões
- [Padrões de Código](patterns/code-patterns.md) — convenções, estrutura de módulo

### Testes
- [Estratégia de Testes](testing/testing-strategy.md) — Jest, mocks, cobertura

### Débitos Técnicos
- [Débitos e Riscos](technical-debts/debts-and-risks.md) — pendências, fragilidades, cuidados

---

## Resumo da Arquitetura

**Stack:** NestJS 11 + PostgreSQL 15 + Prisma 7.8 + pg-boss + JWT

**Deploy:** Railway (Node.js) + PostgreSQL gerenciado

**Padrão:** Monolito modular. Cada domínio = módulo NestJS independente. Business logic em `*.service.ts`, controllers apenas delegam.

**Integrações externas:** Asaas (gateway de pagamento + split + saques) e Z-API (WhatsApp via API).

**Processamento assíncrono:** pg-boss (PostgreSQL-backed queue) para webhooks e notificações.

**Segurança:** JWT global, rate limiting global (100 req/min), PlanGuard por rota, AES-256-GCM para credenciais em repouso.

---

## Módulos Críticos

| Módulo | Por que é crítico |
|---|---|
| `subscription/` | Controla acesso a features — erro = usuários bloqueados ou sem receita |
| `integrations/` | Saques reais com PIX — bug financeiro direto |
| `queue/` | Processamento assíncrono de webhooks — falha = planos não ativados |
| `common/crypto.service.ts` | Credenciais Asaas em repouso — comprometimento = exposição total |
| `automation/` | CRON de lembretes — bug de timezone quebra todos os envios |

---

## Principais Riscos Técnicos

| Risco | Severidade |
|---|---|
| `ENCRYPTION_KEY` perdida = credenciais Asaas inacessíveis | Crítica |
| Webhook não processado + pg-boss fora do ar = plano não ativa | Alta |
| Intermediados PENDING sem reconciliação | Alta |
| Preços hardcoded no código | Média |
| Falta de validação CPF/CNPJ no back-end | Média |

---

## Recomendações Prioritárias

1. Implementar reconciliação de cobranças intermediadas (Fase 4)
2. Mover preços para tabela no banco (`PlanPrice`)
3. Adicionar logs estruturados (substituir `console.log`)
4. Implementar health check com verificação real de dependências
5. Adicionar canal de alerta para DLQ (email/Slack)
