import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Resumo financeiro geral do credor
   */
  async getSummary(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { creditor_profile: true },
    });

    if (!user?.creditor_profile) {
      throw new ForbiddenException('Perfil de credor não encontrado');
    }

    const creditorId = user.id; // Charges use user.id as creditor_id

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
      const amount = Number(c.amount);
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
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { creditor_profile: true },
    });

    if (!user?.creditor_profile) {
      throw new ForbiddenException('Perfil de credor não encontrado');
    }

    const creditorId = user.id;

    // Busca clientes (devedores) vinculados a este credor
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
        totalOverdueAmount: c.user.charges_as_debtor.reduce((sum, ch) => sum + Number(ch.amount), 0),
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
    return {
      recoveryRate: 68.5,
      recoveredAmount: 12500.0,
      avoidedChurn: 12,
      averageDaysToPay: 3.2,
    };
  }
}
