# Plano: Módulo Configurações — Back-End

## Contexto
O front-end do módulo de configurações já está completo com 3 abas (Perfil, Plano, Segurança).
As Server Actions em `front-end/app/actions/profile.ts` chamam 4 endpoints que ainda não existem no back-end:
- `GET /users/me`
- `PATCH /users/me`
- `PATCH /users/me/password`
- `DELETE /users/me`

A aba Plano já funciona via `/subscription/status` (existente). Upload de avatar é excluído do escopo.

---

## Escopo

### Arquivos novos
| Arquivo | Propósito |
|---|---|
| `src/users/dto/update-profile.dto.ts` | DTO name + email com class-validator |
| `src/users/dto/update-password.dto.ts` | DTO current_password + new_password |
| `src/users/users.controller.ts` | 4 rotas autenticadas via `AuthGuard('jwt')` |
| `src/users/users.controller.spec.ts` | Testes do controller |

### Arquivos modificados
| Arquivo | Mudança |
|---|---|
| `src/users/users.service.ts` | +4 métodos: getProfile, updateProfile, updatePassword, deleteAccount |
| `src/users/users.module.ts` | +UsersController no array `controllers` |
| `src/users/users.service.spec.ts` | +mock auditLog + suites para os 4 novos métodos |

Nenhuma migration Prisma necessária — todos os campos já existem no schema.

---

## Implementação

### DTOs

**`update-profile.dto.ts`**
```ts
@IsString() @MinLength(2) @MaxLength(100) name: string
@IsEmail() @MaxLength(255) email: string
```

**`update-password.dto.ts`**
```ts
@IsString() @MaxLength(128) current_password: string
@IsString() @MinLength(8) @MaxLength(128) new_password: string
```

### UsersController
```
@Controller('users')
@UseGuards(AuthGuard('jwt'))
  GET    /users/me           → getProfile(req.user.id)
  PATCH  /users/me           → updateProfile(req.user.id, dto)
  PATCH  /users/me/password  → updatePassword(req.user.id, dto)
  DELETE /users/me           → deleteAccount(req.user.id, req.ip)
```

### UsersService — novos métodos

**getProfile(userId)**
- `prisma.user.findUnique({ where: { id }, select: { id, name, email, phone } })`
- Nunca retorna `password_hash`
- Não encontrou → `NotFoundException`

**updateProfile(userId, dto)**
- Se `dto.email` diferente do atual: `findUnique({ where: { email } })`
  - Se encontrado e `existing.id !== userId` → `ConflictException('Não foi possível atualizar o perfil. Verifique os dados informados.')` (sem user enumeration)
- `prisma.user.update({ select: { id, name, email, phone } })`

**updatePassword(userId, dto)**
- `findUnique({ where: { id } })` → sem `password_hash` → `UnauthorizedException('Credenciais inválidas.')`
- `bcrypt.compare(current_password, user.password_hash)` → falhou → mesmo erro genérico
- `bcrypt.hash(new_password, 12)` → `update({ password_hash })`
- `auditLog.create({ action: 'PASSWORD_CHANGED', entity: 'User', entity_id: userId })`
- Retorna `{ message: 'Senha alterada com sucesso.' }`

**deleteAccount(userId, ipAddress)**
- LGPD: anonimizar PII usando HMAC-SHA256 com `ANON_SALT` (env var)
  - `name` → `'Usuário Deletado'`
  - `email` → `hmac(email)@deleted.invalid` (mantém `@unique`)
  - `phone` → `hmac(phone)` (mantém `@unique`)
  - `password_hash` → `null`
  - `is_registered` → `false` (JWT strategy rejeita futuras requests automaticamente)
- `auditLog.create({ user_id: null, action: 'ACCOUNT_DELETED', entity_id: userId, ip_address })`
  - `user_id: null` porque o FK foi anonimizado
- Não retorna body (`@HttpCode(HttpStatus.NO_CONTENT)`)

### Env var
Adicionar `ANON_SALT` ao `.env.example` (nunca logar, nunca commitar com valor real).

---

## Segurança (checklist obrigatório)
- [x] `@UseGuards(AuthGuard('jwt'))` no controller — nenhuma rota pública
- [x] `password_hash` nunca retornado (Prisma `select` explícito)
- [x] Email uniqueness: erro genérico (sem user enumeration)
- [x] Wrong password: `UnauthorizedException` genérico (sem indicar se email existe)
- [x] bcrypt 12 rounds
- [x] `is_registered = false` após delete → JWT strategy rejeita token automaticamente
- [x] AuditLog em password change e delete
- [x] LGPD: PII anonimizado, histórico financeiro preservado
- [x] `ANON_SALT` via env var
- [x] `ValidationPipe` global já cobre `whitelist: true, forbidNonWhitelisted: true`

---

## Testes (TDD obrigatório)

### users.service.spec.ts — suites adicionais
- `getProfile`: retorna dados sem password_hash; NotFoundException se não encontrado
- `updateProfile`: happy path; ConflictException se email de outro usuário; permite mesmo email
- `updatePassword`: happy path + auditLog; UnauthorizedException se senha errada; UnauthorizedException se sem password_hash
- `deleteAccount`: anonimiza corretamente; auditLog com user_id: null e ip_address

### users.controller.spec.ts (novo)
- Cada rota: delega ao service com parâmetros corretos
- DELETE: extrai `req.ip` e passa ao service

---

## Verificação
```bash
npm run test                   # todos os specs devem passar
npm run dev                    # iniciar back-end
# Testar via front-end ou curl:
# GET    /users/me             → 200 { id, name, email, phone }
# PATCH  /users/me             → 200 perfil atualizado
# PATCH  /users/me/password    → 200 { message }
# DELETE /users/me             → 204 + cookie inválido após
```
