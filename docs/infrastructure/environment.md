# Variáveis de Ambiente

**Arquivo de exemplo:** `back-end/.env.example`

## Variáveis Obrigatórias

| Variável | Descrição | Exemplo |
|---|---|---|
| `DATABASE_URL` | Connection string PostgreSQL | `postgresql://user:pass@host:5432/db` |
| `JWT_SECRET` | Secret para assinar tokens JWT | String aleatória longa |
| `ENCRYPTION_KEY` | Chave AES-256-GCM (64 chars hex = 32 bytes) | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ASAAS_API_KEY` | API key da conta principal Asaas | `$aact_...` |
| `ASAAS_WEBHOOK_SECRET` | Token para validar webhooks do Asaas | String aleatória |
| `FRONTEND_URL` | Origens CORS permitidas | `https://app.recebefacil.com.br` |

## Variáveis Opcionais

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | 3000 | Porta do servidor |
| `NODE_ENV` | `development` | `production` habilita validações extras |
| `ASAAS_API_URL` | `https://sandbox.asaas.com/api/v3` | URL da API Asaas |
| `ZAPI_CLIENT_TOKEN` | — | Token global Z-API (fallback) |
| `ANON_SALT` | — | Salt para anonimização LGPD |

## Segurança das Variáveis

- **Nunca commitar** `.env` no git (está no `.gitignore`)
- **Nunca logar** `JWT_SECRET`, `ENCRYPTION_KEY`, `ASAAS_API_KEY`, `ASAAS_WEBHOOK_SECRET`
- `ENCRYPTION_KEY` deve ter exatamente 64 caracteres hexadecimais (32 bytes)
- Em produção, `JWT_SECRET` ausente → processo encerra com erro no boot

## Validações no Boot (`src/main.ts`)

```typescript
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('[SEGURANÇA] JWT_SECRET é obrigatório em produção.');
}
if (!process.env.DATABASE_URL) {
  throw new Error('[CONFIG] DATABASE_URL não está definida.');
}
```

## ENCRYPTION_KEY — Atenção Especial

Usada pelo `CryptoService` para criptografar `asaas_account_key` em repouso.

**Se a chave for perdida ou trocada:** todas as `asaas_account_key` existentes no banco se tornam indecodificáveis. Não há recuperação sem a chave original.

**Geração segura:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## FRONTEND_URL — Múltiplas Origens

Suporta múltiplas origens separadas por vírgula:

```
FRONTEND_URL=https://app.recebefacil.com.br,https://staging.recebefacil.com.br
```

## Deploy no Railway

Variáveis configuradas via painel do Railway em **Variables**. O script de start é:

```bash
npx prisma migrate deploy && node dist/main
```
