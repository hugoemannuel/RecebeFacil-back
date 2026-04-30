import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { addDays, startOfDay, endOfDay, format } from 'date-fns';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Resumo financeiro geral do credor
   */
  async getSummary(userId: string) {
    const creditorId = userId;

    const charges = await this.prisma.charge.findMany({
      where: { creditor_id: creditorId },
      select: {
        amount: true,
        status: true,
      },
    });

    const summary = {
      totalPaid: 0,
      totalOverdue: 0,
      totalPending: 0,
      countPaid: 0,
      countOverdue: 0,
      countPending: 0,
    };

    charges.forEach((c) => {
      const amount = Number(c.amount) / 100; // Centavos para Real
      if (c.status === 'PAID') {
        summary.totalPaid += amount;
        summary.countPaid++;
      } else if (c.status === 'OVERDUE') {
        summary.totalOverdue += amount;
        summary.countOverdue++;
      } else if (c.status === 'PENDING') {
        summary.totalPending += amount;
        summary.countPending++;
      }
    });

    return summary;
  }

  /**
   * Ranking de Clientes (Piores Pagadores)
   */
  async getCustomerRanking(userId: string) {
    const creditorId = userId;

    const clients = await this.prisma.client.findMany({
      where: { creditor_id: creditorId },
      include: {
        user: {
          include: {
            charges_as_debtor: {
              where: { 
                creditor_id: creditorId,
                status: 'OVERDUE' 
              },
              select: { amount: true },
            },
          },
        },
      },
    });

    const ranking = clients
      .map((c) => ({
        id: c.user.id,
        name: c.user.name,
        overdueCount: c.user.charges_as_debtor.length,
        totalOverdueAmount: c.user.charges_as_debtor.reduce((sum, ch) => sum + Number(ch.amount), 0) / 100,
      }))
      .filter((c) => c.overdueCount > 0)
      .sort((a, b) => b.totalOverdueAmount - a.totalOverdueAmount)
      .slice(0, 10);

    return ranking;
  }

  /**
   * Performance de Recuperação (Eficácia das mensagens)
   */
  async getRecoveryPerformance(userId: string) {
    const creditorId = userId;

    // 1. Total de cobranças que receberam pelo menos um lembrete
    const chargesWithMessages = await this.prisma.charge.findMany({
      where: {
        creditor_id: creditorId,
        messages: { some: {} } // Pelo menos uma mensagem enviada
      },
      include: {
        messages: { orderBy: { sent_at: 'asc' } }
      }
    });

    const totalTargeted = chargesWithMessages.length;
    let recoveredCount = 0;
    let recoveredAmount = 0;
    let totalDaysToPayAfterReminder = 0;

    chargesWithMessages.forEach(charge => {
      if (charge.status === 'PAID' && charge.payment_date) {
        const firstReminder = charge.messages[0].sent_at;
        // Se pagou depois do primeiro lembrete, consideramos recuperação
        if (charge.payment_date > firstReminder) {
          recoveredCount++;
          recoveredAmount += Number(charge.amount) / 100;
          
          const diffTime = Math.abs(charge.payment_date.getTime() - firstReminder.getTime());
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          totalDaysToPayAfterReminder += diffDays;
        }
      }
    });

    const recoveryRate = totalTargeted > 0 ? (recoveredCount / totalTargeted) * 100 : 0;
    const averageDaysToPay = recoveredCount > 0 ? (totalDaysToPayAfterReminder / recoveredCount) : 0;

    return {
      recoveryRate: Number(recoveryRate.toFixed(1)),
      recoveredAmount: recoveredAmount,
      avoidedChurn: recoveredCount, // Simboliza clientes que pagaram após o susto do lembrete
      averageDaysToPay: Number(averageDaysToPay.toFixed(1)),
    };
  }

  /**
   * Projeção de Fluxo de Caixa (Próximos 30 dias)
   */
  async getForecast(userId: string) {
    const creditorId = userId;
    const today = startOfDay(new Date());
    const thirtyDaysFromNow = endOfDay(addDays(today, 30));

    const pendingCharges = await this.prisma.charge.findMany({
      where: {
        creditor_id: creditorId,
        status: { in: ['PENDING', 'OVERDUE'] },
        due_date: { gte: today, lte: thirtyDaysFromNow }
      },
      select: {
        amount: true,
        due_date: true
      }
    });

    // Agrupar por data
    const forecastMap = new Map<string, number>();
    
    // Inicializar os próximos 7 dias (para garantir que o gráfico comece bonito)
    for (let i = 0; i <= 30; i += 5) { // Saltos de 5 em 5 dias para o gráfico não ficar poluído
      const date = format(addDays(today, i), 'dd/MM');
      forecastMap.set(date, 0);
    }

    pendingCharges.forEach(c => {
      const date = format(c.due_date, 'dd/MM');
      // Se não existir no mapa (por causa do pulo de 5 em 5), adicionamos ao ponto mais próximo ou criamos
      const current = forecastMap.get(date) || 0;
      forecastMap.set(date, current + (Number(c.amount) / 100));
    });

    // Converter para array para o Recharts
    const data = Array.from(forecastMap.entries())
      .map(([name, valor]) => ({ name, valor }))
      .sort((a, b) => {
        // Ordenação simples por data dd/MM
        return 0; // A ordem já está correta pelo loop de criação
      });

    return data;
  }
}
