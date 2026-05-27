# Padrões de Código

## Estrutura de um Módulo

```
src/nome-modulo/
├── nome-modulo.module.ts       ← Declaração do módulo NestJS
├── nome-modulo.controller.ts   ← Rotas, guards, extração de userId
├── nome-modulo.service.ts      ← Toda lógica de negócio
├── dto/
│   ├── create-nome.dto.ts      ← DTO de criação
│   └── update-nome.dto.ts      ← DTO de atualização
└── spec/
    └── nome-modulo.service.spec.ts  ← Testes unitários (obrigatório para services)
```

**Controller não tem lógica de negócio:**
```typescript
@Post()
async create(@Req() req: Request, @Body() dto: CreateChargeDto) {
  return this.chargesService.createCharge(req.user.id, dto);
}
```

---

## Extração de userId

Sempre via `req.user.id`, nunca via parâmetro de rota:

```typescript
// ✅ Correto
@Get()
findAll(@Req() req: Request) {
  return this.service.findAll(req.user.id);
}

// ❌ Errado — permite IDOR
@Get(':userId')
findAll(@Param('userId') userId: string) { ... }
```

---

## Queries com Isolamento por Usuário

```typescript
// Lista: sempre WHERE creditor_id = userId
const charges = await this.prisma.charge.findMany({
  where: { creditor_id: userId }
});

// Único: fetch → validar → 403 se não pertence
const charge = await this.prisma.charge.findUnique({ where: { id } });
if (!charge) throw new NotFoundException();
if (charge.creditor_id !== userId) throw new ForbiddenException();
```

---

## DTOs

```typescript
import { IsString, IsInt, Min, IsOptional } from 'class-validator';

export class CreateChargeDto {
  @IsString()
  description: string;

  @IsInt()
  @Min(1)
  amount: number; // centavos

  @IsOptional()
  @IsString()
  customMessage?: string;
}
```

- Usar `class-validator` decorators
- `@IsOptional()` para campos opcionais
- Valores monetários sempre `@IsInt()` em centavos

---

## PlanGuard + RequiresModule

```typescript
@UseGuards(PlanGuard)
@RequiresModule('FINANCE')
@Post('finance/withdraw')
async withdraw(@Req() req: Request, @Body() dto: WithdrawDto) {
  return this.service.requestWithdrawal(req.user.id, dto);
}
```

`req.userPlan` fica disponível no controller após o guard executar.

---

## Valores Monetários

Sempre `Int` em centavos no banco e nos DTOs:
- R$ 1,00 → 100
- R$ 50,99 → 5099
- Formatar para exibição somente no front-end

---

## AuditLog

```typescript
await this.prisma.auditLog.create({
  data: {
    user_id: userId,
    action: 'WITHDRAWAL_REQUESTED',
    entity: 'WithdrawalRecord',
    entity_id: withdrawal.id,
    details: {
      value: withdrawal.value,
      pix_key_type: withdrawal.pix_key_type,
      // NUNCA incluir: pix_key, asaas_account_key, tokens
    },
    ip_address: req.ip,
  }
});
```

---

## Logger

Usar `Logger` do NestJS com contexto de módulo:

```typescript
private readonly logger = new Logger(NomeDoServico.name);

this.logger.log('Mensagem informativa');
this.logger.error('Erro crítico', error.stack);
this.logger.warn('Alerta');
```

Não usar `console.log` em produção.

---

## Tratamento de Erros de Gateway Externo

```typescript
try {
  const result = await this.asaasService.createPayment(data);
  return result;
} catch (error) {
  this.logger.error('Falha ao criar pagamento no Asaas:', error.message);
  throw new BadGatewayException('Serviço de pagamento indisponível.');
}
```

Nunca expor detalhes internos do erro do gateway na resposta HTTP.

---

## Shadow User

Criar devedor quando não existe:

```typescript
let debtor = await this.prisma.user.findUnique({
  where: { phone: normalizePhone(debtorPhone) }
});

if (!debtor) {
  debtor = await this.prisma.user.create({
    data: {
      phone: normalizePhone(debtorPhone),
      name: debtorName,
      is_registered: false,  // Shadow User
    }
  });
}
```

Shadow Users não podem autenticar (rejeitados pela `JwtStrategy`).
