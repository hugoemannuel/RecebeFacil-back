# MB: Feature — Demo Ao Vivo (Back-end)

## Objetivo
Permitir que visitantes da landing page enviem uma mensagem WhatsApp real para si mesmos,
demonstrando o produto. Cada IP só pode disparar uma vez.

---

## Migração Prisma

```prisma
// prisma/schema.prisma — adicionar ao final
model DemoAttempt {
  id        String   @id @default(cuid())
  ipHash    String   @unique  // SHA-256 do IP — não é PII, fora do escopo LGPD
  createdAt DateTime @default(now())
}
```

Rodar: `npx prisma migrate dev --name add_demo_attempt`

---

## Módulo: `src/demo/`

### Arquivos a criar
```
src/demo/
  demo.module.ts
  demo.controller.ts
  demo.service.ts
```

### `demo.service.ts` — lógica central

```ts
// Dependências: PrismaService, WhatsAppService (já existe em src/whatsapp/)
// Injetar via constructor

async sendDemo(ip: string, phone: string, name: string): Promise<{ sent: boolean; blocked: boolean }> {
  const ipHash = createHash('sha256').update(ip).digest('hex');

  const existing = await this.prisma.demoAttempt.findUnique({ where: { ipHash } });
  if (existing) return { sent: false, blocked: true };

  const formattedPhone = phone.replace(/\D/g, ''); // strip não-dígitos
  const message = DEMO_TEMPLATE.replace('{{nome}}', name);

  await this.whatsappService.sendText(formattedPhone, message);
  await this.prisma.demoAttempt.create({ data: { ipHash } });

  return { sent: true, blocked: false };
}
```

### Template fixo (constante no serviço, sem banco)

```ts
const DEMO_TEMPLATE = `Olá *{{nome}}*! 👋

Essa mensagem foi enviada em tempo real pelo *RecebeFácil*.

É assim que seus clientes recebem as cobranças — automático, no WhatsApp, com link PIX.

👉 Crie sua conta grátis: recebefacil.com.br/cadastro`;
```

### `demo.controller.ts`

```ts
// POST /demo/send — sem guard de autenticação (@Public() ou sem @UseGuards)
// Body: { phone: string, name: string }
// IP: extrair de req.ip (NestJS) ou header X-Forwarded-For se atrás de proxy

@Post('send')
async send(@Body() dto: SendDemoDto, @Req() req: Request) {
  const ip = req.headers['x-forwarded-for']?.toString().split(',')[0] ?? req.ip;
  return this.demoService.sendDemo(ip, dto.phone, dto.name);
}
```

### `SendDemoDto`

```ts
export class SendDemoDto {
  @IsString() @IsNotEmpty() name: string;
  @Matches(/^\+?[1-9]\d{9,14}$/) phone: string; // E.164 ou BR sem código
}
```

---

## Registro no AppModule

Importar `DemoModule` em `src/app.module.ts`.

---

## Observações

- **WhatsAppService** já existe no projeto — não criar novo serviço de envio.
- **Sem rate limit adicional** no controller: o próprio `DemoAttempt` já bloqueia por IP.
- **Sem expiração** do bloqueio por ora (MVP). Se quiser liberar após X dias, adicionar `createdAt` check no `findUnique`.
- Resposta sempre HTTP 200 — o campo `blocked: true` sinaliza o front para abrir o modal, sem expor status HTTP semântico que possa ser explorado.
