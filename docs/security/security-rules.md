# Regras de Segurança

## Regras Inegociáveis

### O que NUNCA logar

- `password_hash`
- `JWT_SECRET` ou qualquer token JWT
- `ASAAS_API_KEY`
- `ASAAS_WEBHOOK_SECRET`
- `asaas_account_key` (descriptografada ou criptografada)
- `zapi_instance_token`
- Chave PIX completa
- Dados de cartão de crédito (PAN, CVV, validade)
- Qualquer valor de `ENCRYPTION_KEY`

**Regra prática:** `AuditLog.details` nunca pode conter os campos acima. Mascarar se necessário.

---

### IDOR (Insecure Direct Object Reference)

**Regra:** Sempre filtrar por `creditor_id = userId`. Nunca retornar 404 para recurso de outro usuário — sempre 403.

```typescript
// ✅ Correto
const charge = await prisma.charge.findUnique({ where: { id } });
if (!charge) throw new NotFoundException();
if (charge.creditor_id !== userId) throw new ForbiddenException();

// ❌ Errado — expõe que o recurso existe
if (charge.creditor_id !== userId) throw new NotFoundException();
```

---

### ValidationPipe (Global)

Configurado com:
- `whitelist: true` — remove campos não declarados no DTO
- `forbidNonWhitelisted: true` — retorna 400 se campos extras forem enviados
- `transform: true` — converte tipos automaticamente

**Nunca desabilitar** o `whitelist` — um campo extra aceito pode vazar dados sensíveis ou causar mass assignment.

---

### bcrypt

- Mínimo **12 rounds**
- Nunca reduzir — 12 rounds é o mínimo aceitável
- Em testes: sempre mockar (`jest.mock('bcrypt')`) — nunca rodar hash real nos testes

---

### JWT

- Expiração: 7 dias
- `JWT_SECRET` obrigatório em produção (boot falha sem ele)
- Shadow Users (`is_registered: false`) são rejeitados pela `JwtStrategy`

---

### User Enumeration

`POST /auth/register` e `POST /auth/login` sempre retornam mensagem genérica:

```typescript
// ✅ Correto
throw new UnauthorizedException('Credenciais inválidas.');

// ❌ Errado — revela que o email existe
throw new ConflictException('Email já cadastrado.');
```

---

### Rate Limiting

Global (100 req/min) configurado no `AppModule`.

Rotas com limites específicos:

| Rota | Limite |
|---|---|
| `POST /auth/login` | 5 / 15 min |
| `POST /auth/register` | 10 / 1h |
| `POST /integrations/finance/withdraw` | 1 / min |
| `POST /subscription/retry-payment` | 2 / 5 min |
| `POST /demo/send` | 1 por IP (lifetime via DemoAttempt) |

---

### Criptografia em Repouso

`asaas_account_key` é criptografada com AES-256-GCM antes de salvar:

```typescript
const encrypted = this.crypto.encrypt(plainAccountKey);
await prisma.integrationConfig.update({ data: { asaas_account_key: encrypted } });

// Ao usar:
const plainKey = this.crypto.decrypt(config.asaas_account_key);
// Usar imediatamente, não persistir em variável de longa duração
```

Formato armazenado: `"iv_hex:authTag_hex:ciphertext_hex"`

---

### Helmet

Aplicado globalmente no `main.ts`:
```typescript
app.use(helmet({ crossOriginResourcePolicy: false }));
```

`crossOriginResourcePolicy: false` permite servir arquivos `uploads/` de origens diferentes (imagens de logo).

---

### LGPD — Direito ao Esquecimento

`DELETE /users/account` — não deleta o registro, **anonimiza**:
- `name` → hash anônimo
- `email` → null
- `phone` → hash anônimo
- `password_hash` → null
- `avatar_url` → null

Cobranças e histórico financeiro são mantidos por obrigação legal (auditoria).

---

### Webhook Asaas

Validação manual do header `asaas-access-token`:

```typescript
if (!token || token !== ASAAS_WEBHOOK_SECRET) {
  throw new UnauthorizedException('Invalid webhook token');
}
```

A rota é `@Public()` (sem JWT) — a validação acima é o único mecanismo de autenticidade.

---

### Uploads

- Servidos como arquivos estáticos em `/uploads/`
- `crossOriginResourcePolicy: false` habilitado no Helmet para este path
- Validar tipo MIME e tamanho no endpoint de upload (não documentado aqui — implementar quando criado)
