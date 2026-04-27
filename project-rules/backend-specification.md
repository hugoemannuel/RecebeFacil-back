# Especificação Profunda de Produto e Back-End - RecebeFácil

Este documento detalha a arquitetura, visão de produto e regras de negócio do back-end. A visão aqui vai muito além de um simples CRUD, trazendo estratégias de **Product-Led Growth (Crescimento pelo Produto)**, retenção e estrutura técnica escalável.

---

## 1. A Grande Sacada: O Efeito Viral e a Identidade Única

A maior alavanca de crescimento do RecebeFácil é que **todo pagador é um potencial usuário**. 
Se um Personal Trainer usa a plataforma para cobrar seu aluno (João), o João receberá um link ou mensagem padronizada do RecebeFácil. Ao interagir com essa cobrança, João conhece a plataforma. Como ele também é um freelancer de design, ele percebe que pode usar a mesma ferramenta para cobrar seus clientes.

**Decisão Arquitetural:** 
Não deve existir uma tabela separada e isolada para `Customer` (Cliente) e `User` (Lojista). Todo mundo no sistema é um **`User`**. A diferença é apenas o papel que a pessoa assume em uma cobrança específica (Credor ou Devedor).

### 1.1 O Conceito de "Shadow User"
1. Quando um Lojista cria uma cobrança para um número de WhatsApp (+55 11 99999-9999), o sistema verifica se esse número já existe na base.
2. Se **não existir**, o sistema cria um usuário "fantasma" (`is_registered = false`) com esse telefone. 
3. Quando esse usuário fantasma decidir se cadastrar ativamente na plataforma no futuro, ele confirma o número (via OTP no WhatsApp), define sua senha e se torna um usuário ativo (`is_registered = true`).
4. **O Efeito UAU:** No primeiro login, ele já verá no seu painel o histórico de todas as contas que ele já pagou pelo RecebeFácil.

---

## 2. Modelagem de Dados de Alta Performance (Prisma Schema)

Abaixo está o reflexo do nosso banco de dados, desenhado com foco em crescimento, recorrência e **segurança e auditoria**:

```prisma
model User {
  id            String   @id @default(uuid())
  phone         String   @unique // DDI+DDD+Num (Ex: 5511999999999)
  name          String
  email         String?  @unique
  password_hash String?
  is_registered Boolean  @default(false) // false = Shadow User
  
  // Relacionamentos
  charges_as_creditor   Charge[]                @relation("CreditorCharges")
  charges_as_debtor     Charge[]                @relation("DebtorCharges")
  recurring_as_creditor RecurringCharge[]       @relation("CreditorRecurring")
  recurring_as_debtor   RecurringChargeDebtor[] @relation("DebtorRecurringRecord")
  subscription          Subscription?
  audit_logs            AuditLog[]              @relation("UserAuditLogs")
  
  created_at    DateTime @default(now())
  updated_at    DateTime @updatedAt
}

model Subscription {
  id                   String    @id @default(uuid())
  user_id              String    @unique
  user                 User      @relation(fields: [user_id], references: [id], onDelete: Cascade)
  plan_type            PlanType  // FREE, STARTER, PRO, UNLIMITED
  status               SubStatus // ACTIVE, CANCELED, PAST_DUE
  current_period_start DateTime
  current_period_end   DateTime
  
  created_at           DateTime  @default(now())
  updated_at           DateTime  @updatedAt
}

model Charge {
  id            String       @id @default(uuid())
  creditor_id   String
  debtor_id     String
  amount        Int          // Em centavos (Ex: R$ 50,00 = 5000)
  description   String
  due_date      DateTime
  status        ChargeStatus @default(PENDING) // PENDING, PAID, OVERDUE, CANCELED
  payment_date  DateTime?
  
  creditor      User         @relation("CreditorCharges", fields: [creditor_id], references: [id], onDelete: Cascade)
  debtor        User         @relation("DebtorCharges", fields: [debtor_id], references: [id], onDelete: Cascade)
  messages      MessageHistory[]

  recurring_charge_id String?
  recurring_charge    RecurringCharge? @relation(fields: [recurring_charge_id], references: [id], onDelete: SetNull)

  created_at    DateTime     @default(now())
  updated_at    DateTime     @updatedAt
}

model MessageHistory {
  id            String      @id @default(uuid())
  charge_id     String
  charge        Charge      @relation(fields: [charge_id], references: [id], onDelete: Cascade)
  trigger_type  TriggerType // MANUAL, AUTO_REMINDER_BEFORE, AUTO_REMINDER_DUE, AUTO_REMINDER_OVERDUE
  sent_at       DateTime    @default(now())
  status        String      // SENT, FAILED
}

model RecurringCharge {
  id                   String    @id @default(uuid())
  creditor_id          String
  amount               Int       // Em centavos
  description          String
  frequency            Frequency // WEEKLY, MONTHLY, YEARLY
  next_generation_date DateTime
  active               Boolean   @default(true)
  
  creditor             User      @relation("CreditorRecurring", fields: [creditor_id], references: [id], onDelete: Cascade)
  debtors              RecurringChargeDebtor[]
  charges              Charge[]
  
  created_at           DateTime  @default(now())
  updated_at           DateTime  @updatedAt
}

model RecurringChargeDebtor {
  id                  String          @id @default(uuid())
  recurring_charge_id String
  debtor_id           String
  
  recurring_charge    RecurringCharge @relation(fields: [recurring_charge_id], references: [id], onDelete: Cascade)
  debtor              User            @relation("DebtorRecurringRecord", fields: [debtor_id], references: [id], onDelete: Cascade)
}

model AuditLog {
  id          String   @id @default(uuid())
  user_id     String?  // Quem executou a ação
  action      String   // Ex: "CHARGE_PAID_MANUAL"
  entity      String   // Tabela afetada. Ex: "Charge"
  entity_id   String   // ID do registro afetado
  details     Json?    // JSON "antes e depois"
  ip_address  String?  // IP da requisição
  
  user        User?    @relation("UserAuditLogs", fields: [user_id], references: [id], onDelete: SetNull)

  created_at  DateTime @default(now())
}
```

---

## 3. Regras de Negócio Mais Incisivas

### 3.1 Esteira de Planos e Limites (Upsell)
A plataforma terá múltiplos degraus de planos, permitindo capturar tanto o autônomo iniciante quanto grandes clínicas.

*   **FREE (Gratuito):** Até 10 cobranças/mês. Envio de WhatsApp 100% manual. Sem cobrança em massa.
*   **STARTER (Ex: R$ 29/mês):** Até 50 cobranças/mês. Automação de WhatsApp ativada (robô cobra sozinho). Sem rotinas recorrentes.
*   **PRO (Ex: R$ 69/mês):** Até 200 cobranças/mês. Automação ativada + **Rotinas e Cobrança em Massa**.
*   **UNLIMITED (Ex: R$ 149/mês):** Cobranças ilimitadas. Gestão de múltiplos usuários na mesma conta (time/funcionários) e acesso à API.

*   **O Gatilho (Paywall):** Ao tentar chamar a rota `POST /charges`, o back-end consulta a `Subscription` do `creditor_id` e faz o `COUNT` do ciclo. Se estourar o limite daquele plano, bloqueia com HTTP 403 `LIMIT_REACHED`, ativando o pop-up de upgrade no Front-End.

### 3.2 O Motor de Automação de WhatsApp (O Coração do Produto)
A verdadeira dor do seu público-alvo é **não ter que cobrar as pessoas na mão**. O produto precisa fazer o "trabalho sujo" de ser o "chato" da cobrança.

*   **Plano Free (Mecânica Manual Ativa):** O lojista entra no painel, vê a lista de cobranças e clica no botão "Enviar Cobrança". O sistema pode gerar um link `https://wa.me/...` que abre o WhatsApp do próprio lojista com o texto pronto.
*   **Plano PRO (A Mágica no Background):**
    *   Um CRON Job no NestJS (`@Cron(CronExpression.EVERY_DAY_AT_8AM)`) desperta.
    *   Ele busca todas as cobranças `PENDING` ou `OVERDUE` cujos credores tenham `Subscription.status == ACTIVE` E `plan_type == PRO`.
    *   **Régua de Cobrança Sugerida:**
        *   **2 dias antes:** "Olá João, o Lojista A passou para lembrar que sua parcela de R$ 50,00 vence daqui a 2 dias!"
        *   **No vencimento:** "Oi João! Sua cobrança de R$ 50,00 vence hoje. Segue a chave PIX: X."
        *   **1 dia de atraso:** "João, notamos que o pagamento de ontem ainda não constou. Precisa de ajuda?"
    *   O servidor executa o disparo automaticamente (via API oficial do WhatsApp ou provedor externo) e registra na tabela `MessageHistory`.

### 3.3 Gestão de Risco do WhatsApp
Disparar cobranças via WhatsApp tem risco altíssimo de banimento se as pessoas reportarem como SPAM.
*   **Regra de Ouro:** O número disparador da plataforma NUNCA deve mandar textos agressivos. 
*   **Opt-out:** Toda mensagem automática deve permitir que o pagador digite "PARAR" para não receber mais lembretes via robô daquela cobrança (bloqueando a `Charge` de receber automação). Isso preserva a saúde do seu WhatsApp.

---

## 4. O Fluxo de Transição PENDING -> OVERDUE
Não dependa apenas da visualização. A mudança de status deve ser imutável no banco.
*   Outro CRON Job roda todos os dias à meia-noite (`0 0 0 * * *`).
*   Query: `UPDATE Charge SET status = 'OVERDUE' WHERE status = 'PENDING' AND due_date < NOW();`
*   Isso garante que os dashboards dos usuários estejam 100% precisos quando eles acordarem pela manhã.

---

## 5. Rotinas e Cobrança em Massa (Recorrência)
Para atender a dor de quem cobra muitos alunos/clientes de uma vez (ex: Personal com turma de 15 pessoas, Escola de Idiomas):
*   **Agrupamento em Massa:** O sistema permite criar uma "Rotina de Cobrança" (Tabela `RecurringCharge`), onde o lojista define um valor, uma frequência (ex: mensal) e anexa N clientes (`RecurringChargeDebtor`).
*   **Motor de Recorrência (CRON Job Mensal):** O servidor acorda diariamente, varre as rotinas ativas cuja `next_generation_date` seja hoje, e gera N `Charge`s individuais automaticamente (uma para cada devedor) no banco.
*   Logo em seguida, o Motor de Automação de WhatsApp assume e avisa cada devedor individualmente.
*   Isso economiza dezenas de horas manuais do lojista e ancora um valor percebido altíssimo para vender o plano **PRO** ou **UNLIMITED**.

---

## 6. Segurança e Auditoria
A aplicação segue os preceitos do `security-guidelines.md`:
*   **AuditLog:** Qualquer deleção, downgrade de plano ou marcação manual de pagamento (onde possa haver fraude interna) deve popular a tabela `AuditLog`.
*   **IDOR e Acesso:** Todas as queries em `Charge`, `Subscription` ou `RecurringCharge` **devem obrigatoriamente** carregar o `WHERE { creditor_id: req.user.id }` para garantir que um lojista não espione o outro.
*   **Prevenção de User Enumeration:** Durante o cadastro ou recuperação de senha, a API **nunca** deve retornar mensagens explícitas de que "O e-mail/telefone já está em uso" para o Front-End, pois isso permite que atacantes descubram quais usuários estão na base. Deve-se retornar um erro genérico (ex: "Não foi possível realizar o cadastro com os dados informados") e logar o motivo real apenas no console do servidor (`console.error`).

---

## 7. Qualidade e Testes Automatizados (TDD)
A estabilidade financeira exige cobertura de testes rigorosa. A regra do projeto é inegociável: **Nenhuma funcionalidade sobe para produção sem estar coberta por testes automatizados**.

*   **Testes Unitários:** Todo Service (`*.service.ts`) e Controller (`*.controller.ts`) deve possuir um arquivo `.spec.ts` equivalente validando casos de sucesso e de falha (erros esperados).
*   **Mocks:** Interações com o banco de dados (Prisma) e serviços externos (JWT, APIs) devem ser "mockados" nos testes unitários para garantir isolamento e velocidade de execução.
*   **Comandos:** Utilize `npm run test` para rodar a suíte de testes do NestJS baseada no Jest.

---

## 8. Ambiente Local e Docker (Banco de Dados)
A aplicação utiliza o Docker para gerenciar o banco de dados PostgreSQL local sem "sujar" o seu Windows.
*   **Arquivo criado:** `docker-compose.yml` contendo a imagem `postgres:15-alpine`.
*   **Variáveis de Ambiente (`.env`):** A string do `DATABASE_URL` aponta para o banco hospedado pelo Docker (`postgresql://root:rootpassword@localhost:5432/recebefacil`).

**Fluxo de inicialização do desenvolvedor:**
1. Abrir o Docker Desktop.
2. Rodar no terminal (na pasta `back-end`): `docker-compose up -d`.
3. Rodar as migrations do Prisma: `npx prisma migrate dev`.

---

## 8. Próximos Passos (Ação)

1. **Testar Autenticação (Front-End -> Back-End):** Conectar os formulários de Cadastro e Login do Front-End (Next.js) para chamarem as rotas `/auth/register` e `/auth/login` recém-criadas.
2. **Dashboard e Middlewares (Front-End):** Criar o `middleware.ts` no Front-End para proteger a rota `/dashboard` contra usuários não logados, lendo o cookie JWT.
3. **Módulo de Cobrança (Back-End):** Desenvolver o `ChargeModule` para permitir a criação das primeiras cobranças, aplicando as regras de IDOR e Shadow User.
