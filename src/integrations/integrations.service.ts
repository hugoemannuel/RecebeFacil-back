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
      platformFeePct: Number(term.platform_fee_pct),
      asaasFees: {
        pix: term.asaas_pix_fee,
        boleto: term.asaas_boleto_fee,
        creditCard: term.asaas_card_fee,
      },
      contractText: term.content,
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
    
    return await this.prisma.integrationConfig.upsert({
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
  }
}
