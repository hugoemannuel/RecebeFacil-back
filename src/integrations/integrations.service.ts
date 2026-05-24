import { Injectable, ForbiddenException, Logger, BadRequestException, ConflictException, BadGatewayException, HttpException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AsaasService } from './asaas.service';
import { CryptoService } from '../common/crypto.service';

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    private prisma: PrismaService,
    private asaasService: AsaasService,
    private crypto: CryptoService,
  ) {}

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
   * Registra o aceite dos termos, cria a subconta Asaas e salva walletId.
   */
  async acknowledgeSplitTerms(userId: string, data: {
    version: string,
    document?: string,
    bankData?: any
  }) {
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
      },
    });

    // Cria subconta Asaas para viabilizar o split automático de receita
    try {
      const { walletId } = await this.asaasService.createSubaccount(userId, data.document);
      await this.prisma.integrationConfig.update({
        where: { user_id: userId },
        data: { asaas_wallet_id: walletId },
      });
      this.logger.log(`Subconta Asaas configurada para usuário ${userId}. WalletId: ${walletId}`);
    } catch (err) {
      // Falha na subconta não bloqueia o aceite dos termos — split ficará inativo até retry
      this.logger.warn(`Subconta Asaas não criada para usuário ${userId}: ${err.message}`);
    }

    await this.prisma.auditLog.create({
      data: {
        user_id: userId,
        action: 'SPLIT_TERMS_ACCEPTED',
        entity: 'IntegrationConfig',
        entity_id: config.id,
        details: {
          version: data.version,
          accepted_at: new Date(),
          document_provided: !!data.document,
        },
      },
    });

    return config;
  }

  async getFinanceBalance(userId: string): Promise<{ balance: number; hasSubaccount: boolean }> {
    const config = await this.prisma.integrationConfig.findUnique({
      where: { user_id: userId },
      select: { asaas_account_key: true, split_terms_accepted_at: true },
    });

    const hasSubaccount = !!config?.split_terms_accepted_at;

    if (!config?.asaas_account_key) {
      return { balance: 0, hasSubaccount };
    }

    const accountKey = this.crypto.decrypt(config.asaas_account_key);
    const { balance } = await this.asaasService.getAccountBalance(accountKey);
    return { balance, hasSubaccount };
  }

  async requestWithdrawal(userId: string, data: {
    value: number;
    pixKey: string;
    pixKeyType: string;
    idempotencyKey: string;
  }): Promise<{ id: string; status: string; asaas_transfer_id?: string }> {
    if (data.value <= 0) throw new BadRequestException('Valor deve ser maior que zero.');
    if (data.value < 0.10) throw new BadRequestException('Valor mínimo para saque é R$ 0,10.');

    // Idempotência: mesmo UUID → retornar registro existente sem reprocessar
    const existing = await this.prisma.withdrawalRecord.findUnique({
      where: { idempotency_key: data.idempotencyKey },
    });
    if (existing) {
      if (['PENDING', 'PROCESSING', 'CONFIRMED'].includes(existing.status)) {
        this.logger.log(`Saque idempotente retornado. Key: ${data.idempotencyKey}, status: ${existing.status}`);
        return { id: existing.id, status: existing.status, asaas_transfer_id: existing.asaas_transfer_id ?? undefined };
      }
      throw new ConflictException('Esta solicitação já foi processada. Gere uma nova chave de idempotência para tentar novamente.');
    }

    // Obter e descriptografar a account key da subconta
    const config = await this.prisma.integrationConfig.findUnique({
      where: { user_id: userId },
      select: { asaas_account_key: true },
    });
    if (!config?.asaas_account_key) {
      throw new ForbiddenException('Subconta Asaas não configurada. Aceite os termos de intermediação para habilitar saques.');
    }
    const accountKey = this.crypto.decrypt(config.asaas_account_key);

    // Verificar saldo em tempo real no Asaas
    const { balance } = await this.asaasService.getAccountBalance(accountKey);
    if (balance < data.value) {
      throw new BadRequestException(`Saldo insuficiente. Disponível: R$ ${balance.toFixed(2)}`);
    }

    // Criar registro com proteção contra saques simultâneos do mesmo usuário
    let record: any;
    try {
      record = await this.prisma.$transaction(async (tx) => {
        const concurrent = await tx.withdrawalRecord.findFirst({
          where: { user_id: userId, status: { in: ['PENDING', 'PROCESSING'] } },
        });
        if (concurrent) {
          throw new ConflictException('Já existe um saque em andamento. Aguarde a confirmação antes de solicitar novo saque.');
        }
        return tx.withdrawalRecord.create({
          data: {
            user_id: userId,
            idempotency_key: data.idempotencyKey,
            value: data.value,
            pix_key_masked: this.maskPixKey(data.pixKey, data.pixKeyType),
            pix_key_type: data.pixKeyType,
            status: 'PENDING',
          },
        });
      });
    } catch (err) {
      // Propaga ConflictException; qualquer outro erro de DB é inesperado
      throw err;
    }

    // Chamar Asaas FORA da transação — sem manter lock durante I/O externo
    try {
      const transfer = await this.asaasService.transferViaPixFromSubaccount(accountKey, {
        value: data.value,
        pixKey: data.pixKey,
        pixKeyType: data.pixKeyType,
      });

      await this.prisma.withdrawalRecord.update({
        where: { id: record.id },
        data: {
          status: 'PROCESSING',
          asaas_transfer_id: transfer.id,
          asaas_status: transfer.status,
          processed_at: new Date(),
        },
      });

      await this.prisma.auditLog.create({
        data: {
          user_id: userId,
          action: 'WITHDRAWAL_REQUESTED',
          entity: 'WithdrawalRecord',
          entity_id: record.id,
          // Nunca logar pixKey — somente tipo
          details: { value: data.value, pix_key_type: data.pixKeyType, asaas_transfer_id: transfer.id },
        },
      });

      this.logger.log(`Saque enviado ao Asaas. WithdrawalRecord: ${record.id}, Transfer: ${transfer.id}`);
      return { id: record.id, status: 'PROCESSING', asaas_transfer_id: transfer.id };

    } catch (err) {
      await this.prisma.withdrawalRecord.update({
        where: { id: record.id },
        data: {
          status: 'FAILED',
          failure_reason: err instanceof HttpException ? err.message : 'Falha na comunicação com Asaas',
          failed_at: new Date(),
        },
      });
      this.logger.error(`Saque falhou. WithdrawalRecord: ${record.id}. Motivo: ${err.message}`);
      if (err instanceof HttpException) throw err;
      throw new BadGatewayException('Falha ao processar saque. Tente novamente.');
    }
  }

  async getWithdrawals(userId: string, page = 1, limit = 10) {
    const skip = (page - 1) * limit;
    const [records, total] = await Promise.all([
      this.prisma.withdrawalRecord.findMany({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          value: true,
          pix_key_masked: true,
          pix_key_type: true,
          status: true,
          asaas_transfer_id: true,
          failure_reason: true,
          processed_at: true,
          confirmed_at: true,
          failed_at: true,
          created_at: true,
        },
      }),
      this.prisma.withdrawalRecord.count({ where: { user_id: userId } }),
    ]);
    return { records, total, page, limit, pages: Math.ceil(total / limit) };
  }

  private maskPixKey(pixKey: string, pixKeyType: string): string {
    if (pixKeyType === 'EMAIL') {
      const atIndex = pixKey.indexOf('@');
      if (atIndex < 0) return '***';
      const local = pixKey.slice(0, atIndex);
      const domain = pixKey.slice(atIndex + 1);
      return `${local.slice(0, Math.min(2, local.length))}***@${domain}`;
    }
    if (['CPF', 'CNPJ'].includes(pixKeyType)) {
      return pixKey.slice(0, -4).replace(/\d/g, '*') + pixKey.slice(-4);
    }
    if (pixKeyType === 'PHONE') {
      return pixKey.slice(0, -4).replace(/\d/g, '*') + pixKey.slice(-4);
    }
    // EVP (chave aleatória)
    return `${pixKey.slice(0, 8)}...${pixKey.slice(-4)}`;
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
