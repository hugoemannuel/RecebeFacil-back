import { Injectable } from '@nestjs/common';
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

    // Fallback/Seed inicial se não houver nada no banco
    if (!term) {
      term = await this.prisma.splitTerm.create({
        data: {
          version: '1.0.0',
          platform_fee_pct: 1.0,
          asaas_pix_fee: 'R$ 0,99',
          asaas_boleto_fee: 'R$ 1,99',
          asaas_card_fee: '2.99% + R$ 0,49',
          content: `
### TERMOS DE INTERMEDIAÇÃO DE PAGAMENTOS (SPLIT)

1. **Natureza do Serviço**: O RecebeFácil atua como parceiro tecnológico integrador do gateway Asaas. Ao ativar o split, você utiliza a infraestrutura de subcontas (Asaas Connect).

2. **Taxas da Plataforma**: Pela utilização do serviço de intermediação, automação de baixa e conciliação, o RecebeFácil cobrará uma taxa de 1% (um por cento) sobre o valor bruto de cada cobrança liquidada.

3. **Taxas do Gateway (Asaas)**: Além da taxa da plataforma, o Asaas aplica suas próprias taxas transacionais (ex: R$ 0,99 por PIX). Estas taxas são descontadas diretamente pelo gateway no momento da liquidação.

4. **Criação de Subconta**: Para que o serviço funcione, seus dados (CPF/CNPJ e Bancários) serão enviados ao Asaas para a criação de uma subconta vinculada à conta principal do RecebeFácil.

5. **Responsabilidade**: Você é o único responsável pela veracidade dos dados bancários informados. Valores transferidos para contas incorretas devido a erro no preenchimento não poderão ser recuperados pela plataforma.

6. **Aceite**: Ao clicar em concordar, você autoriza a retenção automática das taxas mencionadas e a criação da sua subconta no ecossistema Asaas Connect.
          `.trim(),
        },
      });
    }

    return {
      version: term.version,
      fees: {
        PRO: 2.0,
        UNLIMITED: 1.0,
      },
      asaasFees: {
        pix: term.asaas_pix_fee,
        boleto: term.asaas_boleto_fee,
        creditCard: term.asaas_card_fee,
      },
      contractText: `
### TERMOS DE INTERMEDIAÇÃO DE PAGAMENTOS (SPLIT)

1. **Natureza do Serviço**: O RecebeFácil atua como parceiro tecnológico integrador do gateway Asaas. Ao ativar o split, você utiliza a infraestrutura de subcontas (Asaas Connect).

2. **Taxas da Plataforma**: Pela utilização do serviço de intermediação, automação de baixa e conciliação, o RecebeFácil cobrará uma taxa de intermediação tecnológica sobre o valor bruto de cada cobrança liquidada, conforme seu plano:
   - **Plano PRO**: 2% (dois por cento)
   - **Plano UNLIMITED**: 1% (um por cento)

3. **Taxas do Gateway (Asaas)**: Além da taxa da plataforma, o Asaas aplica suas próprias taxas transacionais (ex: R$ 0,99 por PIX). Estas taxas são descontadas diretamente pelo gateway no momento da liquidação.

4. **Criação de Subconta**: Para que o serviço funcione, seus dados (CPF/CNPJ e Bancários) serão enviados ao Asaas para a criação de uma subconta vinculada à conta principal do RecebeFácil.

5. **Responsabilidade**: Você é o único responsável pela veracidade dos dados bancários informados.

6. **Aceite**: Ao clicar em concordar, você autoriza a retenção automática das taxas mencionadas.

7. **Inadimplência e Cancelamento**: Caso a fatura da sua assinatura permaneça em aberto por mais de **4 (quatro) dias corridos**, o seu plano será automaticamente cancelado e os serviços de intermediação e split serão suspensos até a regularização.
          `.trim(),
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

  /**
   * Gerenciamento de Automação de WhatsApp
   */
  async getAutomationConfig(userId: string) {
    const config = await this.prisma.integrationConfig.findUnique({
      where: { user_id: userId },
    });

    if (!config) return null;

    return {
      allows_automation: config.allows_automation,
      automation_days_before: (config as any).automation_days_before ?? 1,
      automation_days_after: (config as any).automation_days_after ?? 1,
    };
  }

  async updateAutomationConfig(userId: string, data: {
    allows_automation?: boolean;
    automation_days_before?: number;
    automation_days_after?: number;
  }) {
    return this.prisma.integrationConfig.upsert({
      where: { user_id: userId },
      update: data as any,
      create: {
        user_id: userId,
        ...(data as any),
      },
    });
  }
}
