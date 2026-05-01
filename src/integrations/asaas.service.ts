import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { firstValueFrom } from 'rxjs';
import { PlanType } from '@prisma/client';

@Injectable()
export class AsaasService {
  private readonly logger = new Logger(AsaasService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.baseUrl = this.configService.get<string>('ASAAS_API_URL') || 'https://sandbox.asaas.com/api/v3';
    this.apiKey = this.configService.get<string>('ASAAS_API_KEY') || '';
  }

  private get headers() {
    return {
      'Content-Type': 'application/json',
      access_token: this.apiKey,
    };
  }

  /**
   * Garante que o usuário existe como cliente no Asaas.
   */
  async getOrCreateCustomer(userId: string, document?: string) {
    const user = await this.prisma.user.findUnique({ 
      where: { id: userId },
      include: { integration_config: true, creditor_profile: true }
    });
    
    if (!user) throw new HttpException('Usuário não encontrado', HttpStatus.NOT_FOUND);

    const customerId = user.integration_config?.asaas_customer_id;
    const cpfCnpj = document || user.creditor_profile?.document;

    // Se já tem ID, vamos garantir que o documento está atualizado se foi fornecido
    if (customerId) {
      if (document) {
        try {
          await firstValueFrom(
            this.httpService.post(`${this.baseUrl}/customers/${customerId}`, { cpfCnpj }, { headers: this.headers })
          );
        } catch (e) {
          this.logger.warn(`Não foi possível atualizar o CPF do cliente ${customerId} no Asaas`);
        }
      }
      return customerId;
    }

    const customerPayload = {
      name: user.name,
      email: user.email,
      cpfCnpj: cpfCnpj,
      externalReference: user.id,
      notificationDisabled: false,
    };

    this.logger.log(`Criando cliente no Asaas: ${JSON.stringify(customerPayload)}`);

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/customers`,
          customerPayload,
          { headers: this.headers },
        ),
      );

      const newCustomerId = response.data.id;

      await this.prisma.integrationConfig.upsert({
        where: { user_id: userId },
        update: { asaas_customer_id: newCustomerId },
        create: { user_id: userId, asaas_customer_id: newCustomerId },
      });

      return newCustomerId;
    } catch (error) {
      this.logger.error('Erro ao criar cliente no Asaas', error.response?.data || error.message);
      const msg = error.response?.data?.errors?.[0]?.description || 'Falha na integração com Asaas (Customer)';
      throw new HttpException(msg, HttpStatus.BAD_GATEWAY);
    }
  }

  /**
   * Cria uma assinatura de plano com lógica de split opcional.
   */
  async createPlanSubscription(userId: string, planType: PlanType, period: 'MONTHLY' | 'YEARLY', document?: string) {
    const customerId = await this.getOrCreateCustomer(userId, document);
    
    // Definição de valores (Poderia vir de uma tabela de Planos futuramente)
    const prices = {
      [PlanType.FREE]: 0,
      [PlanType.STARTER]: 49.90,
      [PlanType.PRO]: 99.90,
      [PlanType.UNLIMITED]: 199.90,
    };

    const value = prices[planType];
    if (value === 0) return { status: 'FREE_PLAN' };

    const payload = {
      customer: customerId,
      billingType: 'UNDEFINED',
      value: period === 'YEARLY' ? value * 10 : value,
      nextDueDate: new Date().toISOString().split('T')[0],
      cycle: period === 'YEARLY' ? 'YEARLY' : 'MONTHLY',
      description: `Plano RecebeFácil: ${planType} (${period})`,
    };

    this.logger.log(`Criando assinatura ${planType} para o cliente ${customerId} com payload: ${JSON.stringify(payload)}`);

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/subscriptions`,
          payload,
          { headers: this.headers },
        ),
      );

      this.logger.log(`Resposta do Asaas (Subscription): ${JSON.stringify(response.data)}`);

      let paymentUrl = response.data.invoiceUrl || 
                       response.data.checkoutUrl || 
                       response.data.bankSlipUrl;

      // Se o Asaas não devolver a URL na assinatura, buscamos a primeira cobrança gerada
      if (!paymentUrl) {
        this.logger.log(`URL não encontrada na assinatura ${response.data.id}. Buscando cobrança...`);
        const chargesResponse = await firstValueFrom(
          this.httpService.get(
            `${this.baseUrl}/subscriptions/${response.data.id}/payments`,
            { headers: this.headers }
          )
        );

        if (chargesResponse.data.data && chargesResponse.data.data.length > 0) {
          paymentUrl = chargesResponse.data.data[0].invoiceUrl || 
                      chargesResponse.data.data[0].bankSlipUrl ||
                      chargesResponse.data.data[0].checkoutUrl;
          this.logger.log(`URL encontrada na cobrança: ${paymentUrl}`);
        }
      }

      return {
        invoiceUrl: paymentUrl,
        status: 'PENDING',
        asaasId: response.data.id,
      };
    } catch (error) {
      const asaasError = error.response?.data?.errors?.[0]?.description || error.message;
      this.logger.error(`Erro ao criar assinatura no Asaas: ${asaasError}`, error.response?.data);
      throw new HttpException(`Erro no Asaas: ${asaasError}`, HttpStatus.BAD_GATEWAY);
    }
  }
}
