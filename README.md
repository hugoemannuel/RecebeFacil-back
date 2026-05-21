# RecebeFácil - Back-End

Este é o back-end da plataforma **RecebeFácil**, construído com **NestJS**, **Prisma** e **PostgreSQL**. A API é responsável por gerenciar a lógica de negócios da aplicação, incluindo cobranças (únicas e recorrentes), gestão de clientes, integrações com WhatsApp e Gateway de Pagamento, além de fornecer métricas para o dashboard.

## 🚀 Tecnologias Utilizadas

- **[NestJS](https://nestjs.com/)**: Framework Node.js progressivo para construir aplicações eficientes e escaláveis.
- **[Prisma](https://www.prisma.io/)**: ORM moderno e type-safe.
- **[PostgreSQL](https://www.postgresql.org/)**: Banco de dados relacional (via Docker).
- **[JWT & Passport]**: Autenticação de usuários.
- **[NestJS Throttler]**: Proteção contra ataques de força bruta (Rate Limiting).
- **[NestJS Schedule]**: CRON Jobs para automação de lembretes e recorrências.

## 📂 Arquitetura e Módulos Principais

O back-end é modular e escalável, dividido nos seguintes domínios de negócio (`src/`):

- **Auth & Users**: Autenticação via JWT, registro e "Shadow Users".
- **Charges**: Gerenciamento do ciclo de vida das cobranças (únicas e em lote).
- **Automation & Schedule**: Disparo de lembretes automáticos e gestão de cobranças recorrentes.
- **Subscription**: Gestão de planos (Free, Starter, Pro, Unlimited) via integração com Asaas.
- **Integrations & Webhooks**: Conexão com Z-API (WhatsApp) e Asaas.
- **Dashboard & Reports**: Métricas de recebíveis e relatórios financeiros.
- **Profiles & Clients**: Perfil comercial do lojista e gerenciamento de sua carteira de clientes.

## 🛠️ Como Executar Localmente

### 1. Pré-requisitos
- [Node.js](https://nodejs.org/en/) instalado.
- [Docker](https://www.docker.com/) instalado.

### 2. Configuração do Ambiente
Clone o repositório e acesse a pasta `back-end`:
```bash
cd back-end
```

Copie o arquivo de exemplo `.env.example` para `.env` (certifique-se de configurar as variáveis corretamente, se necessário):
```bash
cp .env.example .env
```

### 3. Subir o Banco de Dados
A aplicação utiliza o Docker para rodar o PostgreSQL de forma isolada:
```bash
docker-compose up -d
```

### 4. Instalar Dependências e Configurar o Prisma
Instale as dependências via npm ou yarn:
```bash
npm install
```

Execute as migrations para criar as tabelas no banco de dados:
```bash
npx prisma migrate dev
```

*(Opcional)* Você pode rodar o seed do banco de dados (se disponível) para popular com dados iniciais:
```bash
npm run seed
```

### 5. Iniciar a Aplicação
Rodar em ambiente de desenvolvimento (watch mode ativado):
```bash
npm run start:dev
```
A API estará rodando em `http://localhost:3001` (ou na porta configurada no seu `.env`).

## 🛡️ Segurança e Regras do Projeto

- **Isolamento de Dados**: A tabela `User` é exclusiva para identidade. Dados sensíveis (como integrações e chaves PIX) vivem em tabelas apartadas (ex: `CreditorProfile`, `IntegrationConfig`).
- **IDOR**: Todas as requisições autenticadas aos dados comerciais utilizam o `creditor_id` do usuário logado atrelado ao token JWT.

---
Desenvolvido por **RecebeFácil**.
