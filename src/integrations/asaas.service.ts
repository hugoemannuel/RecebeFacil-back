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
  async getOrCreateCustomer(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } }) as any;
    if (!user) throw new HttpException('Usuário não encontrado', HttpStatus.NOT_FOUND);

    if (user.asaas_customer_id) {
      return user.asaas_customer_id;
    }

    this.logger.log(`Criando cliente no Asaas para o usuário: ${user.email}`);

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/customers`,
          {
            name: user.name,
            email: user.email,
            externalReference: user.id,
            notificationDisabled: false,
          },
          { headers: this.headers },
        ),
      );

      const customerId = response.data.id;

      await this.prisma.user.update({
        where: { id: userId },
        data: { asaas_customer_id: customerId } as any,
      });

      return customerId;
    } catch (error) {
      this.logger.error('Erro ao criar cliente no Asaas', error.response?.data || error.message);
      throw new HttpException('Falha na integração com Asaas (Customer)', HttpStatus.BAD_GATEWAY);
    }
  }

  /**
   * Cria uma assinatura de plano com lógica de split opcional.
   */
  async createPlanSubscription(userId: string, planType: PlanType, period: 'MONTHLY' | 'YEARLY') {
    const customerId = await this.getOrCreateCustomer(userId);
    
    // Definição de valores (Poderia vir de uma tabela de Planos futuramente)
    const prices = {
      [PlanType.FREE]: 0,
      [PlanType.STARTER]: 49.90,
      [PlanType.PRO]: 99.90,
      [PlanType.UNLIMITED]: 199.90,
    };

    const value = prices[planType];
    if (value === 0) return { status: 'FREE_PLAN' };

    // Lógica de Split (PRO: 2% | UNLIMITED: 1%)
    const split: any[] = [];
    if (planType === PlanType.PRO || planType === PlanType.UNLIMITED) {
      const platformWalletId = this.configService.get<string>('ASAAS_PLATFORM_WALLET_ID');
      const feePercent = planType === PlanType.PRO ? 2.0 : 1.0;

      if (platformWalletId) {
        split.push({
          walletId: platformWalletId,
          percentualValue: feePercent,
        });
      }
    }

    this.logger.log(`Criando assinatura ${planType} para o cliente ${customerId}`);

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/subscriptions`,
          {
            customer: customerId,
            billingType: 'UNDEFINED', // Deixa o usuário escolher no checkout
            value: period === 'YEARLY' ? value * 10 : value, // Exemplo: 2 meses de desconto no anual
            nextDueDate: new Date().toISOString().split('T')[0],
            cycle: period === 'YEARLY' ? 'YEARLY' : 'MONTHLY',
            description: `Plano RecebeFácil: ${planType} (${period})`,
            split,
          },
          { headers: this.headers },
        ),
      );

      return {
        invoiceUrl: response.data.invoiceUrl || response.data.checkoutUrl,
        status: 'PENDING',
        asaasId: response.data.id,
      };
    } catch (error) {
      this.logger.error('Erro ao criar assinatura no Asaas', error.response?.data || error.message);
      throw new HttpException('Falha na integração com Asaas (Subscription)', HttpStatus.BAD_GATEWAY);
    }
  }
}
