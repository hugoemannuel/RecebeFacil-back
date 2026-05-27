# Fluxo: Saque Seguro (PIX)

**Módulo:** `src/integrations/`  
**Serviço:** `IntegrationsService.requestWithdrawal()`  
**Requer plano:** PRO ou UNLIMITED (`@RequiresModule('FINANCE')`)

## Visão Geral

Saque é uma operação financeira irreversível. O fluxo foi projetado para:
- Garantir idempotência (evitar duplo saque em retry/clique duplo)
- Evitar race conditions (transação Prisma + validação de estado)
- Rastrear toda operação no `WithdrawalRecord`
- Nunca persistir a chave PIX completa

## Fluxo Detalhado

```
1. Front-end gera UUID antes de enviar a requisição
        │
        ▼
2. POST /integrations/finance/withdraw
   Body: {
     value: 100.00,
     pixKey: "user@email.com",
     pixKeyType: "EMAIL",
     idempotencyKey: "uuid-v4-gerado-no-front"
   }
        │
        ▼
3. Verificar idempotência:
   → WithdrawalRecord com mesmo idempotencyKey existe?
     - status PROCESSING ou CONFIRMED → retornar estado atual (não reprocessar)
     - status FAILED → permitir novo saque com novo idempotencyKey
        │
        ▼
4. Validar entrada:
   - value >= 0.10 (mínimo)
   - pixKey não vazio
        │
        ▼
5. Descriptografar asaas_account_key via CryptoService
   → Se não houver account_key → erro (sub-conta não configurada)
        │
        ▼
6. Verificar saldo real no Asaas:
   AsaasService.getAccountBalance(accountKey)
   → balance < value → BadRequestException("Saldo insuficiente")
        │
        ▼
7. Transação Prisma:
   → Verificar se há WithdrawalRecord PENDING ou PROCESSING para este user
     - Se sim → ConflictException("Saque em andamento")
   → CREATE WithdrawalRecord:
     - status: PENDING
     - idempotency_key: uuid
     - value: valor solicitado
     - pix_key_masked: mascarar chave (ex: us**@email.com)
     - pix_key_type: tipo da chave
        │
        ▼
8. Chamar Asaas FORA da transação Prisma:
   AsaasService.transferViaPixFromSubaccount(accountKey, {
     value, pixKey, pixKeyType
   })
        │
   ┌────┴────┐
sucesso    falha
   │          │
   ▼          ▼
9a. UPDATE   9b. UPDATE
  status:      status:
  PROCESSING   FAILED
  asaas_       failure_
  transfer_id  reason
  processed_at failed_at
   │
   ▼
10. Retornar: { id, status: 'PROCESSING', asaas_transfer_id }

═══════════════════════════════════════════════
11. Assíncrono — Webhook Asaas (pode demorar minutos)
═══════════════════════════════════════════════

TRANSFER_DONE:
  → WithdrawalRecord.status = CONFIRMED
  → confirmed_at = now()
  → AuditLog: WITHDRAWAL_CONFIRMED

TRANSFER_FAILED:
  → WithdrawalRecord.status = FAILED
  → failure_reason = motivo
  → failed_at = now()
  → AuditLog: WITHDRAWAL_FAILED
```

## GET /integrations/finance/withdrawals

Histórico paginado de saques do usuário.

```
Query params: { page?: number, limit?: number }
Response: { records: WithdrawalRecord[], total: number, page: number, limit: number }
```

**Atenção:** retorna `pix_key_masked` — nunca a chave completa.

## Mascaramento da Chave PIX

| Tipo | Exemplo original | Exemplo mascarado |
|---|---|---|
| EMAIL | user@email.com | us**@email.com |
| CPF | 12345678901 | 123.***.***.** |
| PHONE | 5511999999999 | 5511*****9999 |
| EVP | uuid-v4 | uuid***** |

## Monitoramento

**CRON diário às 8h:** verifica saques com `status = PROCESSING` por mais de 24h.
- Se encontrar → `AuditLog: WITHDRAWAL_STUCK_ALERT`
- Ação manual necessária: verificar status real no painel Asaas

## Riscos e Cuidados

- **🔴 Não alterar a ordem do fluxo** (transação → Asaas fora da transação). Inverter pode causar duplo gasto.
- **🔴 Nunca persistir a chave PIX completa** — apenas `pix_key_masked`
- **`asaas_account_key` criptografado** — descriptografar apenas no momento de uso, nunca logar
- **Race condition protegida** pela verificação de PENDING/PROCESSING dentro da transação Prisma
- Se o saque ficar em PROCESSING > 24h, pode ser um job stuck — verificar DLQ e painel Asaas
- `idempotencyKey` deve ser UUID v4 gerado no front-end **antes** de enviar a requisição (não após falha)
