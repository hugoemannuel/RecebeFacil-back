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

    this.logger.log(`Criando cliente no Asaas. externalReference: ${user.id}`);

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
    
    const prices: Record<string, { monthly: number; yearly: number }> = {
      [PlanType.FREE]:      { monthly: 0,   yearly: 0 },
      [PlanType.STARTER]:   { monthly: 59,  yearly: 564 },   // 20% off = R$47/mês
      [PlanType.PRO]:       { monthly: 99,  yearly: 948 },   // 20% off = R$79/mês
      [PlanType.UNLIMITED]: { monthly: 189, yearly: 1812 },  // 20% off = R$151/mês
    };

    const planPrice = prices[planType];
    if (!planPrice || planPrice.monthly === 0) return { status: 'FREE_PLAN' };

    const value = period === 'YEARLY' ? planPrice.yearly : planPrice.monthly;

    const payload = {
      customer: customerId,
      billingType: 'UNDEFINED',
      value,
      nextDueDate: new Date().toISOString().split('T')[0],
      cycle: period === 'YEARLY' ? 'YEARLY' : 'MONTHLY',
      description: `Plano RecebeFácil ${planType} (${period === 'YEARLY' ? 'Anual' : 'Mensal'})`,
    };

    this.logger.log(`Criando assinatura ${planType} para o cliente ${customerId}. Período: ${period}`);

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/subscriptions`,
          payload,
          { headers: this.headers },
        ),
      );

      this.logger.log(`Assinatura criada no Asaas. ID: ${response.data.id}, status: ${response.data.status}`);

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
        status: response.data.status as string,
        asaasId: response.data.id,
      };
    } catch (error) {
      const asaasError = error.response?.data?.errors?.[0]?.description || error.message;
      this.logger.error(`Erro ao criar assinatura no Asaas: ${asaasError}`, error.response?.data);
      throw new HttpException(`Erro no Asaas: ${asaasError}`, HttpStatus.BAD_GATEWAY);
    }
  }

  async getSubscriptionPaymentUrl(asaasId: string): Promise<string | null> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.baseUrl}/subscriptions/${asaasId}/payments`, { headers: this.headers }),
      );
      const payments: any[] = response.data?.data ?? [];
      const pending = payments.find((p: any) => p.status === 'PENDING') ?? payments[0];
      return pending?.invoiceUrl ?? pending?.bankSlipUrl ?? pending?.checkoutUrl ?? null;
    } catch {
      return null;
    }
  }

  async cancelSubscription(asaasId: string): Promise<void> {
    try {
      await firstValueFrom(
        this.httpService.delete(`${this.baseUrl}/subscriptions/${asaasId}`, { headers: this.headers }),
      );
      this.logger.log(`Assinatura ${asaasId} cancelada no Asaas.`);
    } catch (error) {
      // Não bloqueia o fluxo — a anonimização segue mesmo se o Asaas falhar
      this.logger.warn(`Falha ao cancelar assinatura ${asaasId} no Asaas: ${error.message}`);
    }
  }
}
