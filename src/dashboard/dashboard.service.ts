import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) { }

  async getMetrics(userId: string) {
    const now = new Date();

    // 1. Total a Receber (PENDING)
    const pendingCharges = await this.prisma.charge.aggregate({
      where: { creditor_id: userId, status: 'PENDING' },
      _sum: { amount: true },
    });

    // 2. Atrasados (OVERDUE)
    const overdueCharges = await this.prisma.charge.aggregate({
      where: { creditor_id: userId, status: 'OVERDUE' },
      _sum: { amount: true },
    });

    // 3. Cobranças enviadas este mês
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const sentThisMonth = await this.prisma.charge.count({
      where: { creditor_id: userId, created_at: { gte: startOfMonth } },
    });

    // 4. Conversão (PAID / (PAID + PENDING + OVERDUE))
    const totalCharges = await this.prisma.charge.count({
      where: { creditor_id: userId, status: { in: ['PAID', 'PENDING', 'OVERDUE'] } }
    });
    const paidCharges = await this.prisma.charge.count({
      where: { creditor_id: userId, status: 'PAID' }
    });
    const conversionRate = totalCharges > 0 ? (paidCharges / totalCharges) * 100 : 0;

    // 5. Ação Necessária (Due Tomorrow)
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const endOfTomorrow = new Date(tomorrow);
    endOfTomorrow.setHours(23, 59, 59, 999);

    const dueTomorrowCount = await this.prisma.charge.count({
      where: {
        creditor_id: userId,
        status: 'PENDING',
        due_date: { gte: tomorrow, lte: endOfTomorrow }
      }
    });

    // 6. Top Clientes (GroupBy on debtor_id)
    const topDebtorsRaw = await this.prisma.charge.groupBy({
      by: ['debtor_id'],
      where: { creditor_id: userId },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: 5
    });

    const debtorIds = topDebtorsRaw.map(d => d.debtor_id);
    const debtors = await this.prisma.user.findMany({
      where: { id: { in: debtorIds } },
      select: { id: true, name: true }
    });

    const topClients = topDebtorsRaw.map(d => {
      const name = debtors.find(u => u.id === d.debtor_id)?.name || 'Desconhecido';
      const nameParts = name.split(' ');
      const initials = nameParts.length > 1
        ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
        : name.substring(0, 2).toUpperCase();

      return {
        id: d.debtor_id,
        name,
        totalAmount: d._sum.amount || 0,
        initials
      };
    });

    // 7. Recent Activity (Latest 5 charges)
    const recentActivity = await this.prisma.charge.findMany({
      where: { creditor_id: userId },
      orderBy: { created_at: 'desc' },
      take: 5,
      include: {
        debtor: { select: { name: true, email: true, phone: true } }
      }
    });

    return {
      summary: {
        totalPending: pendingCharges._sum.amount || 0,
        totalOverdue: overdueCharges._sum.amount || 0,
        sentThisMonth,
        conversionRate: conversionRate.toFixed(1)
      },
      actionNecessary: dueTomorrowCount,
      topClients,
      chart: [40, 60, 30, 80, 50, 90, 70],
      recentActivity: recentActivity.map(c => ({
        id: c.id,
        debtorName: c.debtor.name,
        debtorEmail: c.debtor.email || c.debtor.phone,
        amount: c.amount,
        dueDate: c.due_date,
        status: c.status
      }))
    };
  }
}
