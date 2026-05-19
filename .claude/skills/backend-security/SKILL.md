---
name: backend-security
description: Regras de segurança do back-end RecebeFácil — ValidationPipe, IDOR, bcrypt, JWT, rate limiting, user enumeration e o que nunca logar.
when_to_use: Quando criar endpoints, DTOs, lógica de autenticação, queries por ID, webhooks ou qualquer código que lide com dados sensíveis.
---

## ValidationPipe Global (main.ts)

```ts
app.useGlobalPipes(new ValidationPipe({
  whitelist: true,              // remove campos não declarados no DTO
  forbidNonWhitelisted: true,   // rejeita request com campos extras
  transform: true,
}));
```

## DTOs com class-validator

```ts
export class CreateChargeDto {
  @IsString() @IsNotEmpty() debtor_name: string;
  @IsNumber() @Min(100) amount: number;             // mínimo 100 centavos (R$ 1,00)
  @IsString() @MaxLength(200) description: string;
  @IsEnum(['ONCE', 'WEEKLY', 'MONTHLY', 'YEARLY']) recurrence: string;
  @IsOptional() @IsEnum(['CPF', 'CNPJ', 'PHONE', 'EMAIL', 'EVP']) pix_key_type?: string;
}
```

## IDOR — Padrão Obrigatório

```ts
// Where composto para listagens:
this.prisma.charge.findMany({ where: { creditor_id: userId } });

// Check manual para operações por ID:
const charge = await this.prisma.charge.findUnique({ where: { id: chargeId } });
if (!charge || charge.creditor_id !== userId) throw new ForbiddenException();
// Retorna ForbiddenException para não revelar existência do recurso a terceiros
```

## Senhas

```ts
const password_hash = await bcrypt.hash(dto.password, 12);  // mínimo 10 rounds
const isMatch = await bcrypt.compare(pass, user.password_hash);

// SEMPRE strip antes de retornar:
const { password_hash, ...secureUser } = user;
return secureUser;
```

## JWT — Configuração

```ts
secretOrKey: process.env.JWT_SECRET || 'fallback-dev-only'
// JWT_SECRET OBRIGATÓRIO em produção via env
// ignoreExpiration: false (nunca true)
```

## Rate Limiting Global

```ts
// AppModule: ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }])
// Para rotas mais sensíveis:
@Throttle({ default: { ttl: 900000, limit: 5 } })  // 5 tentativas / 15 min
@Post('/auth/login')
```

## SQL Injection

```ts
// CORRETO — template literal do Prisma (parametrizado automaticamente):
await this.prisma.$queryRaw`SELECT * FROM "User" WHERE id = ${id}`;

// PROIBIDO — concatenação de string:
// this.prisma.$queryRaw(`SELECT * FROM User WHERE id = '${id}'`)
```

Prisma ORM previne automaticamente — usar `$queryRaw` apenas se estritamente necessário.

## User Enumeration — Prevenção

```ts
// NUNCA expor que e-mail/telefone já existe:
throw new ConflictException('Não foi possível realizar o cadastro. Verifique os dados informados.');
// Log real apenas internamente:
console.error(`[Auth] E-mail já em uso: ${dto.email}`);
```

## O Que NUNCA Logar

- Senhas em plain-text
- Tokens JWT completos
- `ASAAS_API_KEY`, `ZAPI_INSTANCE_TOKEN`, `ZAPI_CLIENT_TOKEN`
- Números de cartão, CVV, validade (PCI DSS)
- Chaves PIX dos lojistas
- `error_details` de MessageHistory (coluna interna)

## Headers de Segurança

```ts
app.use(helmet());  // obrigatório no main.ts
```

## CORS

```ts
app.enableCors({ origin: ['http://localhost:3000', 'http://localhost:3001'], credentials: true });
// Em produção: trocar para domínio real
```

## Variáveis de Ambiente Críticas

```env
JWT_SECRET=              # OBRIGATÓRIO em produção
ASAAS_API_KEY=           # Nunca no código-fonte
ASAAS_WEBHOOK_SECRET=    # Para validar webhooks
ZAPI_INSTANCE_ID=
ZAPI_INSTANCE_TOKEN=
ZAPI_CLIENT_TOKEN=
DATABASE_URL=
```

Nunca commitar `.env` (`.gitignore` já inclui). Em produção: AWS Secrets Manager ou Railway ENV.

## Mass Assignment — Anti-pattern Crítico

Nunca passar `@Body() data: any` direto para o Prisma sem DTO. Um atacante pode sobrescrever qualquer campo do model.

```ts
// PROIBIDO:
@Patch('automation')
async update(@Body() data: any) {
  return this.service.update(userId, data as any); // vazamento de todos os campos
}

// CORRETO:
@Patch('automation')
async update(@Body() dto: UpdateAutomationDto) {
  return this.service.update(userId, dto); // ValidationPipe filtra campos não declarados
}

// No service: expansão explícita (nunca spread direto do DTO no Prisma):
return this.prisma.integrationConfig.upsert({
  update: {
    ...(dto.allows_automation !== undefined && { allows_automation: dto.allows_automation }),
    ...(dto.automation_days_before !== undefined && { automation_days_before: dto.automation_days_before }),
  },
  create: { user_id: userId, ...dto },
});
```

## Arquivos de Upload

Nunca commitar arquivos binários de usuários (`uploads/`). Sempre incluir `uploads/` no `.gitignore`. Violação: dados de usuário em git history (LGPD).

## Anti-patterns

- Nunca `ignoreExpiration: true` no JWT Strategy
- Nunca salvar dados de cartão — todo processamento via Asaas (PCI DSS)
- Nunca retornar stack trace em produção (`NODE_ENV=production` oculta automaticamente)
- Nunca usar `Math.random()` para gerar tokens/secrets — usar `crypto`
- Nunca `@Body() data: any` — sempre DTO com class-validator
- Nunca `update: data as any` no Prisma — expansão explícita de campos permitidos
