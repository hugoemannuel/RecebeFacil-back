# Autenticação e Autorização

## JWT

**Módulo:** `src/auth/`

**Configuração:**
- Algoritmo: HS256 (padrão `@nestjs/jwt`)
- Expiração: 7 dias (`7d`)
- Secret: `JWT_SECRET` (obrigatório em produção — processo encerra se ausente)
- Fallback dev: `'super-secret-default-key-for-dev-only'` (nunca usar em produção)

**Payload do token:**
```typescript
{ sub: userId, iat, exp }
```

**Strategy (`src/auth/jwt.strategy.ts`):**
- Extrai token do header `Authorization: Bearer <token>`
- Busca `User` no banco pelo `sub`
- Rejeita se `is_registered === false` (Shadow User não pode autenticar)
- Retorna `{ id, name, email, phone }` → injetado em `req.user`

## JwtAuthGuard

**Arquivo:** `src/auth/guards/jwt-auth.guard.ts`  
**Escopo:** Global via `APP_GUARD` em `src/app.module.ts`

Comportamento:
- Rota com `@Public()` → passa sem verificação
- Sem token ou token inválido → 401
- Shadow User → 401

**Como marcar rota pública:**
```typescript
import { Public } from '../auth/decorators/public.decorator';

@Get('webhook')
@Public()
pingWebhook() { ... }
```

## bcrypt

- Rounds: **12** (mínimo inegociável)
- Usado em: `POST /auth/register` e `PATCH /users/me/password`
- Nunca logar `password_hash`
- Em testes: sempre mockar `jest.mock('bcrypt')` — nunca rodar hash real

## PlanGuard

**Arquivo:** `src/common/plan.guard.ts`  
**Escopo:** Por rota (declarado com `@UseGuards(PlanGuard)`)

### Fluxo de decisão

```
1. Ler @RequiresModule da rota via Reflector
2. Sem módulo requerido → retornar true (libera acesso)
3. userId ausente → ForbiddenException
4. Buscar Subscription do userId
5. Sem subscription → effectivePlan = FREE
6. subscription.status !== 'ACTIVE' → effectivePlan = FREE
7. canAccessModule(effectivePlan, requiredModule) === false → ForbiddenException
8. Injetar req.userPlan = effectivePlan
```

**Atenção:** `PAUSED`, `CANCELED`, `OVERDUE`, `PENDING`, `INACTIVE` são tratados como FREE.

### Como usar em controller

```typescript
@UseGuards(PlanGuard)
@RequiresModule('FINANCE')
@Post('finance/withdraw')
async withdraw(@Req() req: Request, @Body() dto: WithdrawDto) {
  return this.service.requestWithdrawal(req.user.id, dto);
}
```

### Módulos por plano

Definido em `src/common/plan-modules.ts`:

| Plano | Módulos disponíveis |
|---|---|
| FREE | HOME, CHARGES |
| STARTER | HOME, CHARGES, CLIENTS, EXCEL_IMPORT, CUSTOM_TEMPLATES |
| PRO | HOME, CHARGES, CLIENTS, EXCEL_IMPORT, CUSTOM_TEMPLATES, FINANCE, RECURRENCE |
| UNLIMITED | HOME, CHARGES, CLIENTS, REPORTS, EXCEL_IMPORT, CUSTOM_TEMPLATES, FINANCE, RECURRENCE |

## IDOR (Insecure Direct Object Reference)

**Regra obrigatória:** Nunca retornar 404 para recursos que existem mas pertencem a outro usuário. Sempre 403.

### Padrão correto

```typescript
// Lista: sempre filtrar por creditor_id
const charges = await this.prisma.charge.findMany({
  where: { creditor_id: userId }
});

// Único: fetch → validar → throw ForbiddenException
const charge = await this.prisma.charge.findUnique({ where: { id } });
if (!charge) throw new NotFoundException();
if (charge.creditor_id !== userId) throw new ForbiddenException(); // Nunca NotFoundException
```

### Por que 403 e não 404?

404 expõe que o recurso existe, permitindo enumeração de IDs. Com 403, o atacante não consegue distinguir "não existe" de "existe mas não é seu".

## Shadow User

Devedores são criados com `is_registered: false` quando uma cobrança é criada para um número de telefone não cadastrado.

- Podem receber cobranças
- **Não podem** autenticar (JwtStrategy rejeita)
- Tornam-se usuários reais via `POST /auth/register` com o mesmo telefone

## User Enumeration

`POST /auth/register` e `POST /auth/login` sempre retornam mensagem genérica em caso de erro. Nunca expor "email já cadastrado" ou "usuário não encontrado".

## Rate Limiting por Rota Sensível

| Rota | Limite |
|---|---|
| `POST /auth/login` | 5 req / 15 min |
| `POST /auth/register` | 10 req / 1h |
| `POST /integrations/finance/withdraw` | 1 req / min |
| `POST /subscription/retry-payment` | 2 req / 5 min |
