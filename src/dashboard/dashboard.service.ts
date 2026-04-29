import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) { }

  async getMetrics(userId: string, period: string = '7days', statusFilter?: string) {
    const now = new Date();

    const [summary, actionNecessary, topClients, chart, recentActivity] = await Promise.all([
      this.getSummaryMetrics(userId),
      this.getActionNecessary(userId, now),
      this.getTopClients(userId),
      this.getChartData(userId, period, now),
      this.getRecentActivity(userId, statusFilter)
    ]);

    return { summary, actionNecessary, topClients, chart, recentActivity };
  }

  private async getSummaryMetrics(userId: string) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [pending, overdue, sentThisMonth, totalSent, total, paid] = await Promise.all([
      this.prisma.charge.aggregate({ where: { creditor_id: userId, status: 'PENDING' }, _sum: { amount: true } }),
      this.prisma.charge.aggregate({ where: { creditor_id: userId, status: 'OVERDUE' }, _sum: { amount: true } }),
      this.prisma.charge.count({ where: { creditor_id: userId, created_at: { gte: startOfMonth } } }),
      this.prisma.charge.count({ where: { creditor_id: userId } }),
      this.prisma.charge.count({ where: { creditor_id: userId, status: { in: ['PAID', 'PENDING', 'OVERDUE'] } } }),
      this.prisma.charge.count({ where: { creditor_id: userId, status: 'PAID' } }),
    ]);

    const conversionRate = total > 0 ? (paid / total) * 100 : 0;

    return {
      totalPending: pending._sum.amount || 0,
      totalOverdue: overdue._sum.amount || 0,
      sentThisMonth,
      totalSent,
      conversionRate: conversionRate.toFixed(1)
    };
  }

  private async getActionNecessary(userId: string, now: Date) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const endOfTomorrow = new Date(tomorrow);
    endOfTomorrow.setHours(23, 59, 59, 999);

    return this.prisma.charge.count({
      where: { creditor_id: userId, status: 'PENDING', due_date: { gte: tomorrow, lte: endOfTomorrow } }
    });
  }

  private async getTopClients(userId: string) {
    const raw = await this.prisma.charge.groupBy({
      by: ['debtor_id'],
      where: {
        creditor_id: userId,
      },
      _sum: { amount: true }, 
      orderBy: { _sum: { amount: 'desc' } }, 
      take: 5
    });
    if (raw.length === 0) return [];
    
    const users = await this.prisma.user.findMany({ where: { id: { in: raw.map(r => r.debtor_id) } } });
    return raw.map(r => {
      const u = users.find(u => u.id === r.debtor_id);
      const name = u?.name || 'Desconhecido';
      const parts = name.split(' ');
      return {
        id: r.debtor_id,
        name,
        totalAmount: r._sum.amount || 0,
        initials: parts.length > 1 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : name.substring(0, 2).toUpperCase()
      };
    });
  }

  private async getChartData(userId: string, period: string, now: Date) {
    const data: { label: string; amount: number; count: number; isToday: boolean }[] = [];
    let max = 1;

    if (period === 'month') {
      const weeks = ['Semana 1', 'Semana 2', 'Semana 3', 'Semana 4'];
      for (let i = 0; i < 4; i++) {
        const start = new Date(now.getFullYear(), now.getMonth(), 1 + (i * 7));
        const end = new Date(now.getFullYear(), now.getMonth(), i === 3 ? 31 : 7 + (i * 7), 23, 59, 59, 999);
        const agg = await this.prisma.charge.aggregate({
          where: { creditor_id: userId, status: 'PAID', payment_date: { gte: start, lte: end } },
          _sum: { amount: true }, _count: true
        });
        const amount = agg._sum.amount || 0;
        if (amount > max) max = amount;
        const isToday = now >= start && now <= end;
        data.push({ label: weeks[i], amount, count: agg._count, isToday });
      }
    } else {
      const dayNames = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
      const currentDay = now.getDay();
      for (let i = 0; i <= 6; i++) {
        const start = new Date(now);
        start.setDate(now.getDate() - currentDay + i);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setHours(23, 59, 59, 999);
        const agg = await this.prisma.charge.aggregate({
          where: { creditor_id: userId, status: 'PAID', payment_date: { gte: start, lte: end } },
          _sum: { amount: true }, _count: true
        });
        const amount = agg._sum.amount || 0;
        if (amount > max) max = amount;
        const isToday = start.getDate() === now.getDate() && start.getMonth() === now.getMonth() && start.getFullYear() === now.getFullYear();
        data.push({ label: dayNames[i], amount, count: agg._count, isToday });
      }
    }

    return data.map(d => ({ ...d, heightPercentage: d.amount === 0 ? 5 : Math.max(10, Math.floor((d.amount / max) * 100)) }));
  }

  private async getRecentActivity(userId: string, statusFilter?: string) {
    const validStatus = statusFilter && ['PENDING', 'PAID', 'OVERDUE', 'CANCELED'].includes(statusFilter) ? statusFilter : undefined;

    const charges = await this.prisma.charge.findMany({
      where: {
        creditor_id: userId,
        ...(validStatus && { status: validStatus as any }),
      },
      orderBy: { created_at: 'desc' },
      take: 10,
      include: { debtor: { select: { name: true, email: true, phone: true } } }
    });
    return charges.map(c => ({
      id: c.id, debtorName: c.debtor.name, debtorEmail: c.debtor.email || c.debtor.phone, amount: c.amount, dueDate: c.due_date, status: c.status
    }));
  }
}
