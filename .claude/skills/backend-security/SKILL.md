---
name: backend-security
description: Regras de segurança do back-end RecebeFácil — ValidationPipe, IDOR, bcrypt, JWT, rate limiting, user enumeration e o que nunca logar.
when_to_use: Quando criar endpoints, DTOs, lógica de autenticação, queries por ID, webhooks ou qualquer código que lide com dados sensíveis.
---

## ValidationPipe Global (main.ts)

```ts
app.useGlobalPipes(new ValidationPipe({
  whitelist: true,              // remove campos não declarados no DTO
  forbidNonWhitelisted: true,   // rejeita request com campos extras (400)
  transform: true,
}));
```

Nunca desabilitar o `whitelist` — campos extras aceitos = mass assignment.

## DTOs com class-validator

```ts
export class CreateChargeDto {
  @IsString() @IsNotEmpty()
  description: string;

  @IsInt() @Min(1)
  amount: number;  // centavos — nunca Float

  @IsOptional()
  @IsEnum(PixKeyType)
  pix_key_type?: PixKeyType;
}
```

Nunca `@Body() data: any` — sempre DTO validado.

## IDOR — Padrão Obrigatório

```ts
// Where composto para listagens — nunca listar sem creditor_id:
this.prisma.charge.findMany({ where: { creditor_id: userId } });

// Check manual para operações por ID:
const charge = await this.prisma.charge.findUnique({ where: { id } });
if (!charge) throw new ForbiddenException();           // Nunca NotFoundException
if (charge.creditor_id !== userId) throw new ForbiddenException(); // Nunca 404
```

**Por que 403 e não 404?** 404 expõe que o recurso existe — permite enumeração de IDs.

## Senhas — bcrypt

```ts
const password_hash = await bcrypt.hash(dto.password, 12);  // MÍNIMO 12 rounds (não 10)
const isMatch = await bcrypt.compare(pass, user.password_hash);

// SEMPRE strip antes de retornar — nunca expor password_hash:
const { password_hash, ...secureUser } = user;
return secureUser;
```

Em testes: sempre `jest.mock('bcrypt')` — nunca rodar hash real.

## JWT

```ts
// jwt.module.ts
JwtModule.register({
  secret: process.env.JWT_SECRET || 'super-secret-default-key-for-dev-only',
  signOptions: { expiresIn: '7d' },
})
// JWT_SECRET obrigatório em produção — processo encerra no boot se ausente
```

Shadow Users (`is_registered: false`) são rejeitados pela JwtStrategy antes de chegar ao controller.

## User Enumeration — Prevenção

```ts
// NUNCA expor que e-mail/telefone já existe:
throw new UnauthorizedException('Credenciais inválidas.');

// Nunca:
throw new ConflictException('E-mail já cadastrado.'); // expõe existência
```

## Rate Limiting

Global: 100 req/min (ThrottlerGuard como APP_GUARD).

Rotas sensíveis com throttle específico:

| Rota | Limite |
|---|---|
| POST /auth/login | 5 / 15 min |
| POST /auth/register | 10 / 1h |
| POST /integrations/finance/withdraw | 1 / min |
| POST /subscription/retry-payment | 2 / 5 min |
| POST /demo/send | 1 por IP (lifetime via DemoAttempt) |

## Criptografia em Repouso (CryptoService)

`asaas_account_key` de cada lojista é criptografada com AES-256-GCM.

```ts
// src/common/crypto.service.ts
// Sempre criptografar antes de salvar:
const encrypted = this.crypto.encrypt(plainAccountKey);
await prisma.integrationConfig.update({ data: { asaas_account_key: encrypted } });

// Descriptografar apenas no momento de uso:
const plainKey = this.crypto.decrypt(config.asaas_account_key);
// Usar imediatamente — não persistir em variável de longa duração
```

`ENCRYPTION_KEY`: string hex de 64 chars (32 bytes). Se perdida, todas as `asaas_account_key` se tornam inacessíveis permanentemente.

## O Que NUNCA Logar

- `password_hash`
- Tokens JWT
- `ASAAS_API_KEY`, `ASAAS_WEBHOOK_SECRET`
- `asaas_account_key` (criptografada ou descriptografada)
- `zapi_instance_token`, `ZAPI_CLIENT_TOKEN`
- Chave PIX completa
- Dados de cartão (PAN, CVV, validade)
- `ENCRYPTION_KEY`
- `error_details` de `MessageHistory` (apenas logs internos)

**AuditLog.details nunca pode conter nenhum dos campos acima.**

## Variáveis de Ambiente Críticas

```env
JWT_SECRET=           # OBRIGATÓRIO — processo encerra se ausente em produção
DATABASE_URL=         # OBRIGATÓRIO — processo encerra se ausente
ENCRYPTION_KEY=       # 64 chars hex — se perdida, credenciais Asaas inacessíveis
ASAAS_API_KEY=        # Nunca no código-fonte
ASAAS_WEBHOOK_SECRET= # Validar webhooks
FRONTEND_URL=         # CORS — múltiplas origens separadas por vírgula
```

## Webhook Asaas — Validação Obrigatória

```ts
// Rota é @Public() — validação manual obrigatória
if (!token || token !== process.env.ASAAS_WEBHOOK_SECRET) {
  throw new UnauthorizedException('Invalid webhook token');
}
```

## LGPD — Direito ao Esquecimento

`DELETE /users/account` não deleta — anonimiza:
- `name`, `phone` → hash anônimo
- `email`, `password_hash`, `avatar_url` → null

Registros financeiros e `AuditLog` são mantidos por obrigação legal.

## Headers de Segurança

```ts
// main.ts — helmet com crossOriginResourcePolicy desabilitado para servir uploads/
app.use(helmet({ crossOriginResourcePolicy: false }));
```

## Anti-patterns

- Nunca `ignoreExpiration: true` no JwtStrategy
- Nunca salvar dados de cartão — PCI DSS proibido (tudo via Asaas)
- Nunca retornar stack trace em produção
- Nunca `Math.random()` para tokens — usar `crypto.randomBytes()`
- Nunca `@Body() data: any` — sempre DTO
- Nunca spread DTO diretamente no Prisma — expansão explícita de campos permitidos
- Nunca `console.error` para logs sensíveis — usar `Logger` do NestJS com contexto
