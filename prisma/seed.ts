import * as dotenv from 'dotenv';
dotenv.config();

import { PrismaClient, PlanType, SubStatus, SubPeriod } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const SPLIT_TERM_CONTENT = `### TERMOS DE INTERMEDIAÇÃO DE PAGAMENTOS — RecebeFácil
**Versão 2.0.0**

---

**PARTES**

**Plataforma:** RecebeFácil, sistema de gestão de cobranças disponível em recebefacil.com.br ("RecebeFácil" ou "Plataforma").

**Assinante:** Pessoa física ou jurídica que assina o plano PRO ou UNLIMITED e aceita estes termos ("Você").

**Gateway:** Asaas Gestão Financeira Incorporada S.A. (CNPJ 19.540.550/0001-21), provedor do serviço de cobrança e liquidação ("Asaas").

---

### 1. OBJETO

Estes termos regulam a ativação do módulo de **intermediação de pagamentos** dos planos PRO e UNLIMITED do RecebeFácil. Ao aceitar, você autoriza a criação de uma **subconta no Asaas** vinculada à sua conta RecebeFácil, por meio da qual suas cobranças serão processadas e liquidadas.

### 2. O QUE O RECEBEFÁCIL FAZ

2.1 Atua exclusivamente como **operador tecnológico**: gera cobranças, envia lembretes automáticos via WhatsApp, processa webhooks de confirmação do Asaas e atualiza o status das cobranças no seu painel.

2.2 **Não** detém, movimenta nem tem acesso aos valores pagos pelos seus clientes. Os recursos são liquidados diretamente pelo Asaas na sua conta bancária cadastrada.

2.3 O RecebeFácil **não é instituição financeira** — essa regulação aplica-se exclusivamente ao Asaas (autorizado pelo Banco Central, Resolução BCB nº 80/2021).

### 3. TAXAS DO ASAAS (GATEWAY)

As taxas abaixo são cobradas pelo **Asaas** diretamente sobre cada transação liquidada e descontadas do valor recebido:

| Modalidade | Taxa |
|---|---|
| **PIX** | R$ 1,99 por transação (100 primeiras do mês isentas; 3 primeiros meses: R$ 0,99) |
| **Boleto** | R$ 1,99 por boleto pago |
| **Cartão de Crédito** | 2,99% + R$ 0,49 por transação |

> Estas taxas são definidas e atualizadas pelo Asaas. Consulte asaas.com/precos-e-taxas para a tabela vigente.

### 4. TAXA DA PLATAFORMA RECEBEFÁCIL

4.1 Pelo módulo de intermediação, automação de baixa e conciliação, o RecebeFácil retém automaticamente, no momento da liquidação:

- **Plano PRO**: **2% (dois por cento)** sobre o valor bruto de cada cobrança liquidada
- **Plano UNLIMITED**: **1% (um por cento)** sobre o valor bruto de cada cobrança liquidada

4.2 **Exemplo (PIX, R$ 500,00, Plano PRO):**

| Item | Valor |
|---|---|
| Valor cobrado do cliente | R$ 500,00 |
| Taxa RecebeFácil (2%) | − R$ 10,00 |
| Taxa Asaas PIX | − R$ 1,99 |
| **Você recebe** | **R$ 488,01** |

4.3 Cobranças não liquidadas (canceladas, recusadas ou não pagas) **não geram cobrança** de taxa.

### 5. CRIAÇÃO DA SUBCONTA ASAAS

5.1 Ao aceitar estes termos, você autoriza o envio dos seus dados cadastrais (nome, CPF/CNPJ, e-mail) ao Asaas para abertura da subconta.

5.2 A aprovação da subconta é decisão exclusiva do Asaas, sujeita a análise de risco interna. O RecebeFácil não garante aprovação.

5.3 Você declara que todos os dados fornecidos são verídicos. É o único responsável por informações bancárias incorretas e por eventuais perdas decorrentes de erro de preenchimento.

### 6. PROTEÇÃO DE DADOS (LGPD — Lei 13.709/18)

6.1 Os dados dos **seus clientes finais** (nome, telefone, CPF, histórico de cobranças) são tratados pelo RecebeFácil na qualidade de **operador de dados**, sendo você o **controlador** responsável (LGPD, art. 7º, II e V).

6.2 Você é responsável por garantir base legal adequada para o tratamento e o envio de mensagens via WhatsApp aos seus clientes (consentimento ou execução contratual).

6.3 O RecebeFácil compartilha dados apenas com: (a) Asaas — para liquidação financeira; (b) Z-API — para envio de notificações WhatsApp. Nenhum dado é vendido ou cedido a terceiros para fins comerciais.

6.4 Seus dados como assinante são tratados com base em **execução de contrato** (LGPD, art. 7º, V) e regidos pela Política de Privacidade disponível em recebefacil.com.br/privacidade.

### 7. ENVIO DE MENSAGENS VIA WHATSAPP

7.1 O RecebeFácil utiliza a Z-API (z-api.io) para envio de notificações. A Z-API opera via WhatsApp Web e não é produto oficial da Meta.

7.2 Você é responsável por garantir que seus clientes consentiram em receber mensagens de cobrança via WhatsApp e deve disponibilizar mecanismo de opt-out (ex.: responder "PARAR").

7.3 O RecebeFácil **não garante entrega** — o WhatsApp pode bloquear números por uso que viole seus Termos de Serviço. Utilize a ferramenta de forma responsável.

### 8. DIREITO DE ARREPENDIMENTO (CDC, Art. 49)

Você pode cancelar esta contratação em até **7 (sete) dias corridos** da assinatura, sem custo, através do painel em Configurações → Plano ou pelo e-mail suporte@recebefacil.com.br. Após este prazo, o cancelamento é efetivo ao término do período pago, sem reembolso proporcional.

### 9. SUSPENSÃO POR INADIMPLÊNCIA

Caso a fatura da sua assinatura RecebeFácil permaneça em aberto por mais de **4 (quatro) dias corridos**, os serviços de intermediação serão suspensos automaticamente até regularização. Cobranças pendentes continuarão visíveis no painel, mas não serão processadas.

### 10. LIMITAÇÃO DE RESPONSABILIDADE

O RecebeFácil não se responsabiliza por: falhas ou indisponibilidade do Asaas ou do WhatsApp; bloqueio de número por uso abusivo; inadimplência dos clientes finais do assinante; ou perdas decorrentes de uso incorreto da plataforma. A responsabilidade máxima do RecebeFácil é limitada ao valor pago nos últimos 3 (três) meses de assinatura.

### 11. ALTERAÇÕES NESTES TERMOS

O RecebeFácil pode atualizar estes termos com aviso prévio de 15 dias via e-mail cadastrado. A continuidade do uso após esse prazo implica aceitação das alterações.

---

*Ao clicar em "Concordar e Contratar", você declara ter lido, compreendido e aceito integralmente estes termos.*`;

async function main() {
  const user = await prisma.user.findFirst({
    where: { is_registered: true },
    select: { id: true, name: true, email: true },
  });

  if (!user) {
    console.log('Nenhum usuário registrado encontrado. Cadastre-se primeiro.');
    return;
  }

  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setFullYear(periodEnd.getFullYear() + 1);

  const sub = await prisma.subscription.upsert({
    where: { user_id: user.id },
    update: {
      plan_type: PlanType.UNLIMITED,
      status: SubStatus.ACTIVE,
      period: SubPeriod.YEARLY,
      current_period_start: now,
      current_period_end: periodEnd,
    },
    create: {
      user_id: user.id,
      plan_type: PlanType.UNLIMITED,
      status: SubStatus.ACTIVE,
      period: SubPeriod.YEARLY,
      current_period_start: now,
      current_period_end: periodEnd,
    },
  });

  console.log(`Plano UNLIMITED YEARLY atribuído a ${user.name} (${user.email})`);
  console.log(`Válido até: ${periodEnd.toLocaleDateString('pt-BR')}`);
  console.log(`Subscription ID: ${sub.id}`);

  await prisma.splitTerm.upsert({
    where: { version: '2.0.0' },
    update: {
      is_active: true,
      content: SPLIT_TERM_CONTENT,
      asaas_pix_fee: 'R$ 1,99',
      asaas_boleto_fee: 'R$ 1,99',
      asaas_card_fee: '2,99% + R$ 0,49',
    },
    create: {
      version: '2.0.0',
      platform_fee_pct: 1.0,
      asaas_pix_fee: 'R$ 1,99',
      asaas_boleto_fee: 'R$ 1,99',
      asaas_card_fee: '2,99% + R$ 0,49',
      content: SPLIT_TERM_CONTENT,
      is_active: true,
    },
  });

  await prisma.integrationConfig.upsert({
    where: { user_id: user.id },
    update: {
      split_terms_accepted_at: now,
      split_terms_version: '2.0.0',
    },
    create: {
      user_id: user.id,
      split_terms_accepted_at: now,
      split_terms_version: '2.0.0',
    },
  });

  console.log('SplitTerm v2.0.0 populado e termos aceitos para o usuário de dev.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
