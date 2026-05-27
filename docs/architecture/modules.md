# Módulos — Mapa de Dependências

## Tabela de Módulos

| Módulo | Arquivo | Responsabilidade |
|---|---|---|
| `AppModule` | `src/app.module.ts` | Raiz; registra guards globais |
| `AuthModule` | `src/auth/` | Registro, login, JWT strategy |
| `UsersModule` | `src/users/` | Perfil, senha, LGPD |
| `ChargesModule` | `src/charges/` | CRUD cobranças, recorrências, bulk |
| `ClientsModule` | `src/clients/` | Vínculo credor↔devedor |
| `ProfilesModule` | `src/profiles/` | CreditorProfile, PIX, logo |
| `SubscriptionModule` | `src/subscription/` | Planos, checkout, faturas |
| `IntegrationsModule` | `src/integrations/` | Asaas API, Z-API config, saques |
| `AutomationModule` | `src/automation/` | CRON jobs |
| `DashboardModule` | `src/dashboard/` | Métricas de recebíveis |
| `ReportsModule` | `src/reports/` | **Stub — não implementado** |
| `WhatsAppModule` | `src/whatsapp/` | Envio de mensagens Z-API |
| `QueueModule` | `src/queue/` | pg-boss service e constantes |
| `ZapiWebhookModule` | `src/webhooks/` | Recepção de mensagens entrantes |
| `DemoModule` | `src/demo/` | Demonstração pública (rate limit IP) |
| `PrismaModule` | `src/prisma/` | PrismaService global singleton |

## Dependências por Módulo

### AuthModule
- Depende de: `UsersModule`, `PrismaModule`
- Exporta: `JwtAuthGuard`
- Consumidores: `AppModule` (APP_GUARD global)

### ChargesModule
- Depende de: `PrismaModule`, `WhatsAppModule`
- Usa: `PlanGuard` + `@RequiresModule('CHARGES')`
- Acesso restrito por plano: sim

### SubscriptionModule
- Depende de: `PrismaModule`, `IntegrationsModule` (via `AsaasService`)
- Crítico: ativa/desativa acesso a features

### IntegrationsModule
- Depende de: `PrismaModule`, `QueueModule`, `WhatsAppModule`, `CryptoService` (common)
- Exporta: `AsaasService` (usado por `SubscriptionModule`)
- Contém: `AsaasWebhookController`, `AsaasWebhookWorker`

### AutomationModule
- Depende de: `PrismaModule`, `WhatsAppModule`
- Independente: não exporta nada, roda via CRON interno

### QueueModule
- Depende de: `DATABASE_URL` (env)
- Exporta: `PgBossService`
- Consumidores: `IntegrationsModule`, `AutomationModule`

### WhatsAppModule
- Sem dependências internas
- Exporta: `WhatsAppService`
- Consumidores: `ChargesModule`, `AutomationModule`, `DemoModule`

### PrismaModule
- Global (`isGlobal: true`)
- Sem dependências internas
- Disponível em todos os módulos sem import explícito

## Diagrama de Dependências

```
AppModule
  ├─ AuthModule ────────────────── UsersModule ── PrismaModule
  ├─ ChargesModule ─────────────── WhatsAppModule
  │                            └── PrismaModule
  ├─ SubscriptionModule ─────────── IntegrationsModule
  │                                   ├─ AsaasService
  │                                   ├─ QueueModule ── PrismaModule
  │                                   └─ WhatsAppModule
  ├─ AutomationModule ──────────── WhatsAppModule
  │                            └── PrismaModule
  ├─ DashboardModule ───────────── PrismaModule
  ├─ ProfilesModule ────────────── PrismaModule
  ├─ ClientsModule ─────────────── PrismaModule
  ├─ ZapiWebhookModule ─────────── PrismaModule
  ├─ DemoModule ────────────────── PrismaModule
  │                            └── WhatsAppModule
  └─ ReportsModule ─────────────── PrismaModule (stub)
```

## Common (não é módulo NestJS)

Arquivo `src/common/` contém utilitários sem módulo próprio:

| Arquivo | Função |
|---|---|
| `plan.guard.ts` | Guard: verifica plano + módulo por rota |
| `plan-modules.ts` | Constantes: `PLAN_MODULES`, `TEMPLATE_LIMITS`, `canAccessModule()` |
| `requires-module.decorator.ts` | Decorator `@RequiresModule('MODULE')` |
| `crypto.service.ts` | AES-256-GCM — encrypt/decrypt de credenciais |
| `system-templates.ts` | Templates de mensagem padrão do sistema |

`CryptoService` é providenciado pelo `IntegrationsModule` e `PlanGuard` é providenciado pelos módulos que o usam.
