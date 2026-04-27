# WhatsApp & Motor de Cobranças - RecebeFácil

Este documento define a arquitetura técnica completa para integração com o WhatsApp via **Z-API**, o fluxo de criação de cobranças e o motor de envio de mensagens personalizadas com PIX.

---

## 1. Por que Z-API?

A **Z-API** (`https://z-api.io` | Docs: `https://docs.z-api.io`) é a solução escolhida pelos seguintes motivos:

| Critério | Z-API | Evolution API |
|---|---|---|
| **Modelo** | SaaS gerenciado | Self-hosted (requer servidor) |
| **Setup** | Nenhum — apenas cadastro | Requer VPS + Docker + Nginx + SSL |
| **Suporte** | PT-BR, time dedicado | Comunidade open-source |
| **Botão PIX nativo** | ✅ Endpoint dedicado | ❌ Não suportado nativamente |
| **Custo** | Por instância (~R$50-100/mês) | Hospedagem própria |
| **Ideal para** | MVP rápido e estável | Escala avançada (futuro) |

> ⚠️ **Decisão de arquitetura:** A Z-API é o gateway WhatsApp do MVP. A integração com Evolution API self-hosted é uma possibilidade futura para reduzir custos em escala.

---

## 2. Conceitos Fundamentais Z-API

### 2.1. Instância e Autenticação

Cada número de WhatsApp conectado é uma **Instância** na Z-API. Cada lojista do RecebeFácil que utilizar o envio automático precisará **conectar seu próprio WhatsApp** (modelo "trazer o próprio número") ou o RecebeFácil poderá ter um número compartilhado para envios.

**Decisão para o MVP:** Um número único do RecebeFácil envia as cobranças. O lojista não precisa conectar o seu WhatsApp.

**URL base de todas as chamadas:**
```
https://api.z-api.io/instances/{instanceId}/token/{token}/
```

**Header obrigatório:**
```
Client-Token: {client_token}
```

### 2.2. Variáveis de Ambiente Necessárias

```env
ZAPI_INSTANCE_ID=         # ID da instância no painel Z-API
ZAPI_INSTANCE_TOKEN=      # Token da instância
ZAPI_CLIENT_TOKEN=        # Client Token de segurança (header)
ZAPI_BASE_URL=https://api.z-api.io/instances  # URL base
```

---

## 3. Endpoints Utilizados

### 3.1. Enviar Texto Simples
```
POST /instances/{instanceId}/token/{token}/send-text
```
```json
{
  "phone": "5511999999999",
  "message": "Olá *João*, sua cobrança de *R$ 150,00* vence hoje! 💰"
}
```
- Suporta formatação WhatsApp: `*negrito*`, `_itálico_`, `~tachado~`, ` ```código``` `
- Suporta emojis e quebras de linha com `\n`

### 3.2. Enviar Imagem (QR Code PIX)
```
POST /instances/{instanceId}/token/{token}/send-image
```
```json
{
  "phone": "5511999999999",
  "image": "data:image/png;base64,{BASE64_DO_QR_CODE}",
  "caption": "📱 Escaneie o QR Code para pagar via PIX"
}
```
- `image` aceita **URL pública** ou **Base64** (`data:image/png;base64,...`)
- `caption` é exibido abaixo da imagem no WhatsApp

### 3.3. Enviar Botão PIX Nativo ⭐
```
POST /instances/{instanceId}/token/{token}/send-button-pix
```
```json
{
  "phone": "5511999999999",
  "pixKey": "11999999999",
  "type": "PHONE",
  "merchantName": "RecebeFácil - João Barbearia"
}
```
**Tipos de chave PIX:**
- `CPF` → Chave PIX por CPF
- `CNPJ` → Chave PIX por CNPJ
- `PHONE` → Número de telefone
- `EMAIL` → E-mail
- `EVP` → Chave aleatória

> 🌟 **Este é o endpoint mais valioso**: envia uma mensagem com um botão nativo do WhatsApp que abre o app de pagamentos do usuário automaticamente com a chave PIX preenchida — sem copiar nada!

---

## 4. Fluxo Completo de Envio de Cobrança

```
Lojista cria cobrança no RecebeFácil
        ↓
POST /charges  (back-end)
        ↓
ChargeService cria Charge no banco (status: PENDING)
        ↓
        ┌─ Tem QR Code de imagem? ─── SIM ──→ WhatsAppService.sendImage()
        │                                      (POST /send-image com base64)
        │
        └─ Tem chave PIX? ─────────── SIM ──→ WhatsAppService.sendPixButton()
                                               (POST /send-button-pix)
        ↓
        WhatsAppService.sendText()  ← mensagem principal customizada
        (POST /send-text)
        ↓
MessageHistory criado no banco { trigger_type: MANUAL, status: 'SENT' }
        ↓
AuditLog criado { action: 'CHARGE_SENT', details: { messageId } }
```

**Regra de envio:** O back-end envia as mensagens nesta ordem:
1. **Mensagem de texto** com o template customizado
2. **Imagem do QR Code** (se fornecida) com caption informativo
3. **Botão PIX nativo** (se chave PIX configurada) — maior taxa de conversão

---

## 5. Sistema de Templates de Mensagem

O lojista define um **template personalizado** com variáveis que são substituídas automaticamente no momento do envio.

### 5.1. Variáveis Disponíveis

| Variável | Substituída por |
|---|---|
| `{{nome}}` | Nome do devedor |
| `{{valor}}` | Valor formatado (ex: R$ 150,00) |
| `{{vencimento}}` | Data de vencimento formatada (ex: 30/04/2026) |
| `{{descricao}}` | Descrição da cobrança |
| `{{dias_atraso}}` | Número de dias em atraso (para lembretes) |
| `{{nome_empresa}}` | Nome do lojista/empresa |
| `{{link_pix}}` | Chave PIX do lojista |

### 5.2. Templates Padrão por Gatilho

```
[MANUAL - Cobrança inicial]
Olá *{{nome}}*! 👋

Passando para lembrar da sua cobrança com *{{nome_empresa}}*:

💰 Valor: *R$ {{valor}}*
📅 Vencimento: *{{vencimento}}*
📝 Referência: {{descricao}}

Para pagar via PIX, use a chave abaixo ou escaneie o QR Code. ✅

Qualquer dúvida, estamos à disposição!

[AUTO_REMINDER_BEFORE - 1 dia antes do vencimento]
⏰ *{{nome}}*, sua cobrança vence amanhã!

Valor: *R$ {{valor}}*
Não deixe para última hora — pague agora via PIX! 💳

[AUTO_REMINDER_OVERDUE - Em atraso]
⚠️ *{{nome}}*, sua cobrança está *{{dias_atraso}} dia(s)* em atraso.

Valor: *R$ {{valor}}*

Regularize agora para evitar transtornos. Estamos aqui para ajudar!
```

### 5.3. Ciclo de Vida do Template — Aprendizado Inteligente

O sistema aprende com o lojista e evolui ao longo do uso:

**Primeiro envio (sem template salvo):**
1. Drawer carrega os **templates padrão do sistema** (Seção 5.2) pré-populados.
2. Lojista pode editar livremente.
3. Ao confirmar o envio, o back-end verifica: `MessageTemplate` existe para este `creditor_profile_id` + `trigger = MANUAL`?
4. Se **não existe** → salva automaticamente como template padrão (`is_default = true`) com o texto usado.
5. Se **já existe** → usa como está (não sobrescreve sem pedido explícito).

**Envios subsequentes:**
1. Drawer carrega o **template salvo do banco** já pré-populado — lojista só precisa confirmar.
2. Se lojista editar e o texto for diferente do salvo → exibe banner sutil: *"Salvar esta mensagem como meu padrão?"* [Sim] [Não]
3. Se confirmar [Sim] → `PUT /message-templates/{id}` atualiza o template no banco.

**Limites por plano (model `MessageTemplate`):**

| Plano | Templates por gatilho | Templates totais |
|---|---|---|
| FREE | 1 (somente padrão do sistema, **não editável**) | 1 |
| STARTER | 1 customizável e salvo no banco | 3 |
| PRO | Ilimitado | Ilimitado |
| UNLIMITED | Ilimitado | Ilimitado |

> 💡 **Regra PLG (Free):** O usuário FREE vê o editor de mensagem, mas ao tentar salvar um template personalizado, o sistema exibe o `UpgradeModal` sugerindo o plano STARTER. Ele **ainda pode enviar** com a mensagem customizada uma vez — só não consegue salvar como padrão.

**Variáveis exibidas no drawer como chips clicáveis:**
O editor mostra um painel de chips: `[{{nome}}]` `[{{valor}}]` `[{{vencimento}}]` `[{{descricao}}]` `[{{nome_empresa}}]` — ao clicar, insere a variável no cursor do textarea.

**Onde fica no banco:**
Tabela `MessageTemplate` (já no schema) → `creditor_profile_id` + `trigger` + `body` + `is_default`.
O `back-end` expõe:
- `GET /message-templates` → lista templates do lojista autenticado
- `POST /message-templates` → cria novo (respeitando limite do plano)
- `PUT /message-templates/:id` → atualiza corpo
- `DELETE /message-templates/:id` → remove

---

## 6. Configuração de PIX pelo Lojista

No **perfil/configurações**, o lojista configura:

| Campo | Tipo | Obrigatório |
|---|---|---|
| `pix_key` | String | Sim (para envio automático) |
| `pix_key_type` | Enum: CPF/CNPJ/PHONE/EMAIL/EVP | Sim |
| `pix_merchant_name` | String (max 25 chars) | Sim (aparece no app de pagamento) |
| `pix_qr_code_image` | Base64/URL | Opcional (melhora conversão) |

> ⚠️ O `pix_merchant_name` é o nome exibido no aplicativo de pagamentos do cliente quando ele abre o link PIX. Use o nome da empresa — máximo 25 caracteres (limitação do protocolo PIX).

---

## 7. Campos no Schema Prisma (Arquitetura Normalizada)

> ⚠️ Seguindo a **Regra de Ouro** do `backend-specification.md` (Seção 2), dados de PIX e WhatsApp **nunca** vão na tabela `User`. Cada domínio tem sua própria tabela.

### 7.1. `CreditorProfile` — Dados de negócio e PIX

```prisma
model CreditorProfile {
  id                String     @id @default(uuid())
  user_id           String     @unique
  user              User       @relation(...)
  business_name     String?                      // Nome da empresa/profissional
  pix_key           String?                      // Chave PIX
  pix_key_type      PixKeyType?                  // CPF | CNPJ | PHONE | EMAIL | EVP
  pix_merchant_name String?    @db.VarChar(25)   // Máx 25 chars (protocolo PIX)
  pix_qr_code_url   String?                      // URL pública do QR Code
  message_templates MessageTemplate[]
}
```

### 7.2. `MessageTemplate` — Templates WhatsApp por lojista

```prisma
model MessageTemplate {
  id                  String          @id @default(uuid())
  creditor_profile_id String
  name                String          // "Cobrança Inicial", "Lembrete Amigável"
  trigger             MessageTrigger  // MANUAL | BEFORE_DUE | ON_DUE | OVERDUE
  body                String          // Texto com variáveis {{nome}}, {{valor}}, etc.
  is_default          Boolean         @default(false)
}
```

### 7.3. `IntegrationConfig` — Credenciais de terceiros

```prisma
model IntegrationConfig {
  id                  String  @id @default(uuid())
  user_id             String  @unique
  zapi_instance_id    String? // ID da instância Z-API (futuro: número próprio do lojista)
  zapi_instance_token String? // Token da instância
  allows_automation   Boolean @default(true)   // Opt-out (devedor enviou PARAR)
  asaas_customer_id   String? // ID do lojista no Asaas
  asaas_wallet_id     String? // Sub-conta Asaas Connect (split — feature futura)
  asaas_account_key   String? // Chave de acesso (criptografar em repouso - AES-256)
}
```

**Por que separar?**
- Uma invasão que veja apenas `User` não obtém chaves PIX, nem tokens Z-API.
- Uma invasão que veja apenas `IntegrationConfig` não obtém senhas de usuário.
- `MessageTemplate` pode ter permissões de banco mais abertas (leitura pública), enquanto `IntegrationConfig` fica atrás de permissões restritas.

---

## 8. Tratamento de Erros e Retentativas

*   **Fila de envio:** Cobranças programadas para envio automático devem usar uma fila (BullMQ + Redis, no futuro) para garantir retentativas em caso de falha.
*   **Status de mensagem:** Após o envio, atualizar `MessageHistory.status`:
    - `SENT` → Z-API retornou 200 com `messageId`
    - `FAILED` → Z-API retornou erro (logar o erro, não expor ao usuário)
*   **Throttle:** Aguardar no mínimo 1-2 segundos entre mensagens em envios em massa para evitar que o número seja bloqueado pelo WhatsApp.
*   **Opt-Out:** Monitorar respostas via Webhook Z-API. Se o cliente responder "PARAR" ou "CANCELAR", registrar `allows_automation = false` no Shadow User.

---

## 9. Segurança

*   As credenciais Z-API (`ZAPI_INSTANCE_ID`, `ZAPI_INSTANCE_TOKEN`, `ZAPI_CLIENT_TOKEN`) são tão sensíveis quanto a senha do banco. Nunca commitar em código ou logar.
*   O `WhatsAppService` deve ser o **único ponto de integração** com a Z-API no back-end. Nenhum controller deve chamar a Z-API diretamente.
*   Em desenvolvimento, usar variável `DISABLE_WHATSAPP=true` para mockar os envios e não consumir a API real.
