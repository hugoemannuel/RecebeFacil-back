# Arquitetura — Visão Geral

## Stack

| Camada | Tecnologia |
|---|---|
| Framework | NestJS 11 |
| Linguagem | TypeScript 5 |
| ORM | Prisma 7.8 |
| Banco de dados | PostgreSQL 15 |
| Fila assíncrona | pg-boss (PostgreSQL-backed) |
| Autenticação | JWT (7 dias) + bcrypt 12 rounds |
| Criptografia em repouso | AES-256-GCM (`CryptoService`) |
| Agendamento | `@nestjs/schedule` (CRON) |
| HTTP Security | Helmet + CORS |
| Rate Limiting | `@nestjs/throttler` |
| Deploy | Railway (Node.js) |

## Padrão Arquitetural

**Monolito modular.** Cada domínio é um módulo NestJS independente:
- Business logic em `*.service.ts`
- Controllers apenas delegam (`return this.service.method(userId, dto)`)
- DTOs com `class-validator` + `ValidationPipe` global (`whitelist: true`)
- Guards registrados globalmente via `APP_GUARD`

## Bootstrap (`src/main.ts`)

Validações de segurança no boot:
- `JWT_SECRET` obrigatório em produção → processo encerra se ausente
- `DATABASE_URL` obrigatório → processo encerra se ausente
- Pasta `uploads/` criada automaticamente
- `ValidationPipe` global com `whitelist: true, forbidNonWhitelisted: true, transform: true`
- Helmet aplicado (exceto `crossOriginResourcePolicy`)
- CORS restrito a `FRONTEND_URL` (múltiplas origens separadas por vírgula)
- Body limit: 1mb (JSON e URL-encoded)

## Guards Globais (`src/app.module.ts`)

Ordem de execução por requisição:

```
1. ThrottlerGuard  → 100 req/min por IP/usuário (global)
2. JwtAuthGuard    → valida JWT; injeta req.user (global)
3. PlanGuard       → verifica plano (apenas em rotas com @RequiresModule)
```

Rotas marcadas com `@Public()` ignoram o `JwtAuthGuard`.

## Separação de Responsabilidades no Schema

```
User               → Identidade e autenticação apenas
CreditorProfile    → Dados comerciais, PIX, logo
IntegrationConfig  → Credenciais de terceiros (Z-API, Asaas)
Subscription       → Plano ativo e status de pagamento
```

Essa separação evita vazamento de dados sensíveis: uma query em `User` nunca retorna credenciais Asaas ou dados de PIX.

## Processamento Assíncrono

pg-boss roda dentro do mesmo processo Node.js, usando o mesmo `DATABASE_URL`. Filas são tabelas no PostgreSQL — não há infraestrutura separada (Redis, RabbitMQ).

Dois workers ativos:
- `AsaasWebhookWorker` → processa eventos do Asaas
- `NotificationWorker` → envia mensagens WhatsApp via Z-API (quando implementado)

## Diagrama de Componentes

```
HTTP Request
     │
     ▼
ThrottlerGuard ──→ 429 se exceder 100 req/min
     │
JwtAuthGuard  ──→ 401 se token inválido ou shadow user
     │
[PlanGuard]   ──→ 403 se plano não tem módulo (quando @RequiresModule presente)
     │
Controller
     │
Service ──→ PrismaService ──→ PostgreSQL
         └→ AsaasService  ──→ Asaas API
         └→ WhatsAppService → Z-API
         └→ PgBossService  ──→ PostgreSQL (filas)
```

## Estrutura de Pastas

```
back-end/
├── src/
│   ├── app.module.ts / main.ts       ← Bootstrap e módulo raiz
│   ├── auth/                         ← JWT, bcrypt, JwtStrategy
│   ├── users/                        ← Perfil, senha, LGPD
│   ├── charges/                      ← Cobranças + recorrências
│   ├── clients/                      ← Clientes (credor↔devedor)
│   ├── profiles/                     ← CreditorProfile + PIX
│   ├── subscription/                 ← Planos + Asaas checkout
│   ├── integrations/                 ← Asaas API + saques + webhooks
│   ├── automation/                   ← CRON: lembretes + recorrências
│   ├── dashboard/                    ← Métricas (paralelo, sem N+1)
│   ├── reports/                      ← Stub (não implementado)
│   ├── whatsapp/                     ← Z-API service (ponto único)
│   ├── queue/                        ← pg-boss service + constantes
│   ├── webhooks/                     ← Z-API webhook receiver
│   ├── demo/                         ← Endpoint público (rate limit IP)
│   ├── common/                       ← PlanGuard, CryptoService, decorators
│   └── prisma/                       ← PrismaService singleton
├── prisma/
│   ├── schema.prisma                 ← Fonte da verdade do schema
│   ├── migrations/                   ← 13 migrations até 2026-05-26
│   └── seed.ts / seed-templates.ts   ← Dados iniciais
└── docs/                             ← Esta documentação
```
