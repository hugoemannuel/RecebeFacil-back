# Diretrizes de Segurança e Privacidade (Security & LGPD) - RecebeFácil

Este documento é o guia definitivo de segurança (Security by Design) para o desenvolvimento do back-end do RecebeFácil. Todas as novas funcionalidades, rotas ou tabelas de banco de dados devem, obrigatoriamente, ser validadas contra as regras descritas aqui antes de irem para produção.

---

## 1. LGPD (Lei Geral de Proteção de Dados) & Privacidade

Como a plataforma lida com dados sensíveis de cobrança e números de telefone pessoal (WhatsApp), a responsabilidade é altíssima.

*   **Minimização de Dados:** Só solicite e armazene o que for estritamente necessário. Não guarde dados sensíveis se não tiver utilidade clara.
*   **Anonimização e Direito ao Esquecimento (Art. 18):** Se um "Shadow User" (pessoa cobrada) ou um Lojista solicitar exclusão de dados, o sistema não pode quebrar a integridade financeira, mas **DEVE** anonimizar os dados pessoais (Nome vira "Usuário Deletado", Telefone/Email vira um hash irreversível ou string vazia pseudo-randômica).
*   **Tratamento de PII (Personally Identifiable Information):** Jamais exponha listas abertas de telefones. Paginações de clientes na API devem retornar exclusivamente os clientes pertencentes ao `user_id` logado.
*   **Termos de Uso e Opt-In/Opt-Out:** O robô do WhatsApp deve obrigatoriamente permitir o envio da palavra "PARAR" para bloquear futuras automações, registrando isso no banco (coluna `allows_automation = false` ou bloqueio similar na entidade).

---

## 2. Autenticação e Autorização (Prevenindo IDOR e Vazamentos)

A falha mais comum em SaaS financeiros é o IDOR (Insecure Direct Object Reference) — quando o Usuário A consegue alterar o ID da URL e acessar a Cobrança do Usuário B.

*   **Validação de Propriedade (Ownership Check):**
    *   Toda rota que recebe um `:id` na URL (ex: `GET /charges/:id` ou `PATCH /customers/:id`) DEVE verificar se o recurso pertence ao usuário autenticado no JWT (`req.user.id`).
    *   *Exemplo:* `prisma.charge.findUnique({ where: { id: chargeId, creditor_id: req.user.id } })`. Se não encontrar, retorne `404 Not Found` (e não 403, para não vazar que aquele ID existe).
*   **Senhas Fortes e JWT:**
    *   Senhas NUNCA trafegam em plain-text. Devem ser salvas com `bcrypt` (no mínimo 10 rounds) ou `Argon2`.
    *   Tokens JWT devem ter vida curta (Ex: 1h a 2h) para o Access Token. Refresh Tokens devem ser gerados de forma rotativa e invalidados no logout.
    *   Utilize Guardiões (`@UseGuards(JwtAuthGuard)`) de forma global no NestJS e libere apenas as rotas públicas (Login/Webhook) explicitamente.

---

## 3. Blindagem de Inputs e Prevenção de Injections (SQLi, XSS)

Mesmo usando ORM, a segurança não pode ser presumida.

*   **SQL Injection (SQLi) e NoSQLi:**
    *   O uso do **Prisma ORM** nativamente previne 99% dos SQL Injections porque escapa as variáveis.
    *   **REGRA DE OURO:** Se em algum momento for ESTRITAMENTE NECESSÁRIO usar `prisma.$queryRaw` (Query crua), use a tag template literal do Prisma (`$queryRaw\`SELECT * FROM User WHERE id = ${id}\``) que parametriza automaticamente. **NUNCA** faça concatenação de strings em SQL (`"SELECT * FROM User WHERE id = " + id`).
*   **XSS (Cross-Site Scripting) no Back-End:**
    *   A descrição das cobranças (`description`) e nomes de clientes são inputs do usuário.
    *   Use o **ValidationPipe** do NestJS em modo estrito.
    *   Nas DTOs, use `class-validator` (ex: `@IsString()`, `@MaxLength(255)`).
    *   Configure `whitelist: true` e `forbidNonWhitelisted: true` no `ValidationPipe` global. Isso impede que hackers injetem campos não mapeados no payload (Mass Assignment).

---

## 4. Proteção contra Ataques de Força Bruta e DDoS

O RecebeFácil possui endpoints vitais que podem ser alvos de ataques automatizados (Bots).

*   **Rate Limiting (Throttler):**
    *   O pacote `@nestjs/throttler` deve ser ativado globalmente.
    *   *Limites Sugeridos:*
        *   API Global: 100 requests por minuto por IP.
        *   `POST /auth/login`: Máximo 5 tentativas a cada 15 minutos (evitar quebra de senha).
        *   Roteadores de SMS/WhatsApp OTP: Máximo 3 envios por telefone por hora (evita esgotar seu saldo da API do WhatsApp ou SMS).
*   **Timeout e Payload Size:**
    *   Configure o Express/Fastify no Nest para rejeitar JSONs maiores que `1mb` (evita esgotar a memória do servidor com payloads gigantes).

---

## 5. Cuidados Específicos com Webhooks (Integrações Futuras)

Ao integrar com APIs externas de WhatsApp (Z-API, Evolution) ou Pagamentos (Stripe, Mercado Pago):

*   **Validação de Assinatura:** Nunca confie cegamente num `POST` feito para as rotas `/webhooks/*`. Valide o `Secret` / `Signature` enviado no cabeçalho do request para ter certeza de que quem chamou a rota foi a provedora real e não um hacker.
*   **Idempotência:** Webhooks falham e dão retries. Se o webhook avisar que "A Cobrança X foi paga", verifique no banco se ela JÁ ESTÁ paga antes de atualizar de novo e rodar as automações de agradecimento (evita disparar 3 mensagens de "Obrigado" pro mesmo cliente).

---

## 6. Logs de Auditoria e Tratamento de Erros

*   **Vazamento de Stack Trace:** Em ambiente de produção, a aplicação DEVE rodar com `NODE_ENV=production`. O NestJS oculta a Stack Trace de erros 500 por padrão, não altere isso. O cliente nunca pode ver o erro interno do banco de dados na resposta HTTP.
*   **O que NUNCA logar:** Senhas, Tokens JWT, chaves de API, textos inteiros de WhatsApp, ou cartões de crédito. Mascare esses dados antes de enviar para ferramentas de log (DataDog, CloudWatch).
*   **Auditoria de Mudanças Críticas:** Mudanças de plano, deleção de usuários ou marcação de "Pago" manualmente devem, idealmente, deixar um rastro. Crie logs que identifiquem `QUEM (user_id)` fez a ação, `O QUE (action)` e `QUANDO (timestamp)`.

---

## 7. Segurança Específica: Gateway de Pagamento (Asaas) e Cartões de Crédito

Esta seção complementa a Seção 5 com regras específicas para a integração com o Asaas e dados de pagamento.

*   **PCI DSS — Proibição Absoluta de Armazenar Dados de Cartão:**
    O RecebeFácil **jamais** deve armazenar número de cartão, CVV ou data de validade em seus servidores ou logs. Todo o processamento de cartão é delegado ao Asaas, que é certificado PCI DSS. Utilize o **Asaas.js** para tokenização no browser se necessário.

*   **Webhook do Asaas — Validação de Origem:**
    O endpoint `POST /webhooks/asaas` é público (sem JWT). Por isso, **obrigatoriamente** deve validar o token de acesso enviado no header `asaas-access-token` contra a variável de ambiente `ASAAS_WEBHOOK_SECRET`. Qualquer chamada sem o token válido deve retornar `401 UNAUTHORIZED` sem processar nenhuma ação.

*   **Idempotência em Webhooks de Pagamento:**
    Antes de atualizar o status de uma assinatura para `ACTIVE`, verificar se o `asaas_payment_id` já foi processado anteriormente. Webhooks são retransmitidos em caso de falha — nunca processar o mesmo evento de pagamento mais de uma vez.

*   **Chave de API do Asaas:**
    A `ASAAS_API_KEY` é tão sensível quanto uma senha de banco de dados. Ela NUNCA deve estar no código-fonte, ser commitada no git ou exibida em logs. Usar exclusivamente variáveis de ambiente.

*   **Dados de Sub-Conta (Asaas Connect — Feature Futura):**
    Quando a feature de split de pagamentos for implementada, o `asaas_account_key` do lojista será extremamente sensível. Deve ser criptografado em repouso no banco de dados (AES-256) e jamais retornado em endpoints de leitura.

