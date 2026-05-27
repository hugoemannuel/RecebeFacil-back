# Ciclo de Vida de uma Requisição

## Fluxo Completo (rota autenticada com PlanGuard)

```
Cliente HTTP
     │
     ▼
1. ThrottlerGuard (global)
   → Verifica limite: 100 req/min por IP
   → Excedeu → 429 TooManyRequests
     │
     ▼
2. JwtAuthGuard (global)
   → Rota tem @Public()? → passa direto
   → Extrai Bearer token do header Authorization
   → Verifica assinatura com JWT_SECRET
   → Expirado ou inválido → 401 Unauthorized
   → Decodifica payload → busca User no banco
   → is_registered === false (Shadow User) → 401
   → Injeta req.user = { id, name, email, phone }
     │
     ▼
3. ValidationPipe (global)
   → Valida body/query/params contra DTO
   → whitelist: true → strip campos não declarados
   → forbidNonWhitelisted: true → 400 se campo extra
   → transform: true → converte tipos (string → number, etc.)
     │
     ▼
4. PlanGuard (rota com @RequiresModule)
   → Sem @RequiresModule → passa direto
   → Busca Subscription do userId no banco
   → Sem subscription → effectivePlan = FREE
   → status !== 'ACTIVE' → effectivePlan = FREE
   → canAccessModule(effectivePlan, 'MODULE') === false → 403
   → Injeta req.userPlan = effectivePlan
     │
     ▼
5. Controller
   → Extrai userId de req.user.id
   → Chama this.service.method(userId, dto)
   → Não contém lógica de negócio
     │
     ▼
6. Service
   → Lógica de negócio
   → Queries sempre com WHERE creditor_id = userId (IDOR prevention)
   → Retorna dados ou lança exceção
     │
     ▼
7. Serialização
   → NestJS serializa retorno para JSON
   → Resposta HTTP 200/201/204
```

## Rotas Públicas (`@Public()`)

Pulam o `JwtAuthGuard` mas ainda passam por:
- `ThrottlerGuard`
- `ValidationPipe`

Rotas públicas existentes:
- `POST /auth/login`
- `POST /auth/register`
- `POST /integrations/asaas/webhook` (valida `asaas-access-token` manualmente)
- `GET /integrations/asaas/webhook` (health check)
- `POST /demo/send` (rate limit por IP hash)
- `POST /webhooks/zapi/message`

## Erros Padrão por Camada

| Camada | Código | Motivo |
|---|---|---|
| ThrottlerGuard | 429 | Excedeu rate limit |
| JwtAuthGuard | 401 | Token ausente, inválido, expirado ou shadow user |
| ValidationPipe | 400 | Corpo inválido, campo extra ou tipo errado |
| PlanGuard | 403 | Plano não tem acesso ao módulo |
| Service (IDOR) | 403 | Recurso de outro usuário (nunca 404) |
| Service (not found) | 404 | Recurso não existe |
| Service (conflito) | 409 | Duplicidade (ex: idempotência de saque) |
| Gateway externo | 502 | Asaas ou Z-API indisponível |
