import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class IntegrationsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Retorna os termos de split e as taxas atuais.
   * Centralizado no backend para facilitar atualizações legais.
   */
  /**
   * Retorna os termos de split e as taxas atuais.
   * Busca no banco de dados o termo ativo.
   */
  async getSplitTerms() {
    let term = await this.prisma.splitTerm.findFirst({
      where: { is_active: true },
      orderBy: { created_at: 'desc' },
    });

    if (!term) {
      term = await this.prisma.splitTerm.create({
        data: {
          version: '2.0.0',
          platform_fee_pct: 1.0,
          asaas_pix_fee: 'R$ 1,99',
          asaas_boleto_fee: 'R$ 1,99',
          asaas_card_fee: '2,99% + R$ 0,49',
          content: 'ver contractText',
        },
      });
    }

    const contractText = `### TERMOS DE INTERMEDIAÇÃO DE PAGAMENTOS — RecebeFácil
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

    return {
      version: term.version,
      fees: { PRO: 2.0, UNLIMITED: 1.0 },
      asaasFees: {
        pix: term.asaas_pix_fee,
        boleto: term.asaas_boleto_fee,
        creditCard: term.asaas_card_fee,
      },
      contractText,
    };
  }

  /**
   * Registra o aceite dos termos e salva dados da subconta.
   */
  async acknowledgeSplitTerms(userId: string, data: { 
    version: string, 
    document?: string,
    bankData?: any 
  }) {
    // Aqui no futuro faremos a chamada real para o Asaas para criar a subaccount.
    // Por enquanto, salvamos o aceite e os dados no IntegrationConfig.
    
    const config = await this.prisma.integrationConfig.upsert({
      where: { user_id: userId },
      update: {
        split_terms_accepted_at: new Date(),
        split_terms_version: data.version,
      },
      create: {
        user_id: userId,
        split_terms_accepted_at: new Date(),
        split_terms_version: data.version,
      }
    });

    // Auditoria Geral (Imutável)
    await this.prisma.auditLog.create({
      data: {
        user_id: userId,
        action: 'SPLIT_TERMS_ACCEPTED',
        entity: 'IntegrationConfig',
        entity_id: config.id,
        details: { 
          version: data.version,
          accepted_at: new Date(),
          document_provided: !!data.document
        }
      }
    });

    return config;
  }

  async getSplitStatus(userId: string): Promise<{ accepted: boolean }> {
    const config = await this.prisma.integrationConfig.findUnique({
      where: { user_id: userId },
      select: { split_terms_accepted_at: true },
    });
    return { accepted: !!config?.split_terms_accepted_at };
  }

  async getAutomationConfig(userId: string) {
    const config = await this.prisma.integrationConfig.findUnique({
      where: { user_id: userId },
    });

    if (!config) return null;

    return {
      allows_automation: config.allows_automation,
      automation_days_before: config.automation_days_before,
      automation_days_after: config.automation_days_after,
      send_hour: config.send_hour,
      allow_before_due: config.allow_before_due,
      allow_on_due: config.allow_on_due,
      allow_overdue: config.allow_overdue,
    };
  }

  async getZapiConfig(userId: string) {
    const [config, subscription] = await Promise.all([
      this.prisma.integrationConfig.findUnique({ where: { user_id: userId } }),
      this.prisma.subscription.findFirst({
        where: { user_id: userId, status: 'ACTIVE', plan_type: 'UNLIMITED' },
      }),
    ]);
    return {
      zapi_instance_id: config?.zapi_instance_id ?? null,
      has_token: !!(config?.zapi_instance_token),
      has_credentials: !!(config?.zapi_instance_id && config?.zapi_instance_token),
      can_use_own_zapi: !!subscription,
    };
  }

  async updateZapiConfig(userId: string, data: { instance_id: string; instance_token: string }) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { user_id: userId, status: 'ACTIVE', plan_type: 'UNLIMITED' },
    });
    if (!subscription) {
      throw new ForbiddenException('Número de WhatsApp próprio está disponível apenas no plano Unlimited.');
    }
    return this.prisma.integrationConfig.upsert({
      where: { user_id: userId },
      update: {
        zapi_instance_id: data.instance_id,
        zapi_instance_token: data.instance_token,
      },
      create: {
        user_id: userId,
        zapi_instance_id: data.instance_id,
        zapi_instance_token: data.instance_token,
      },
    });
  }

  async disconnectZapi(userId: string) {
    return this.prisma.integrationConfig.upsert({
      where: { user_id: userId },
      update: { zapi_instance_id: null, zapi_instance_token: null },
      create: { user_id: userId },
    });
  }

  async updateAutomationConfig(userId: string, data: {
    allows_automation?: boolean;
    automation_days_before?: number;
    automation_days_after?: number;
    send_hour?: number;
    allow_before_due?: boolean;
    allow_on_due?: boolean;
    allow_overdue?: boolean;
  }) {
    return this.prisma.integrationConfig.upsert({
      where: { user_id: userId },
      update: {
        ...(data.allows_automation !== undefined && { allows_automation: data.allows_automation }),
        ...(data.automation_days_before !== undefined && { automation_days_before: data.automation_days_before }),
        ...(data.automation_days_after !== undefined && { automation_days_after: data.automation_days_after }),
        ...(data.send_hour !== undefined && { send_hour: data.send_hour }),
        ...(data.allow_before_due !== undefined && { allow_before_due: data.allow_before_due }),
        ...(data.allow_on_due !== undefined && { allow_on_due: data.allow_on_due }),
        ...(data.allow_overdue !== undefined && { allow_overdue: data.allow_overdue }),
      },
      create: {
        user_id: userId,
        allows_automation: data.allows_automation ?? true,
        automation_days_before: data.automation_days_before ?? 2,
        automation_days_after: data.automation_days_after ?? 1,
        send_hour: data.send_hour ?? 9,
        allow_before_due: data.allow_before_due ?? true,
        allow_on_due: data.allow_on_due ?? true,
        allow_overdue: data.allow_overdue ?? true,
      },
    });
  }
}
