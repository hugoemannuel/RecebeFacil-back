import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) { }

  async getMetrics(userId: string, period: string = '7days', statusFilter?: string, targetDate?: string) {
    const realNow = new Date();
    let now = new Date();
    if (targetDate) {
      const [y, m, d] = targetDate.split('-');
      now = new Date(Number(y), Number(m) - 1, Number(d));
    }

    let scopeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    let scopeEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    let prevStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0);
    let prevEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);

    if (period === 'month') {
      const day = now.getDate();
      let weekIndex = Math.floor((day - 1) / 7);
      if (weekIndex > 3) weekIndex = 3;
      
      scopeStart = new Date(now.getFullYear(), now.getMonth(), 1 + (weekIndex * 7), 0, 0, 0, 0);
      scopeEnd = new Date(now.getFullYear(), now.getMonth(), weekIndex === 3 ? 31 : 7 + (weekIndex * 7), 23, 59, 59, 999);
      
      const prevWeekIndex = weekIndex > 0 ? weekIndex - 1 : 0;
      prevStart = new Date(now.getFullYear(), now.getMonth(), 1 + (prevWeekIndex * 7), 0, 0, 0, 0);
      prevEnd = new Date(now.getFullYear(), now.getMonth(), prevWeekIndex === 3 ? 31 : 7 + (prevWeekIndex * 7), 23, 59, 59, 999);
    }

    const [summary, actionNecessary, topClients, chart, recentActivity] = await Promise.all([
      this.getSummaryMetrics(userId, now, scopeStart, scopeEnd, prevStart, prevEnd),
      this.getActionNecessary(userId, now),
      this.getTopClients(userId, scopeStart, scopeEnd),
      this.getChartData(userId, period, realNow),
      this.getRecentActivity(userId, statusFilter, scopeStart, scopeEnd)
    ]);

    return { summary, actionNecessary, topClients, chart, recentActivity };
  }

  private async getSummaryMetrics(userId: string, now: Date, scopeStart: Date, scopeEnd: Date, prevStart: Date, prevEnd: Date) {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const orScope = [
      { created_at: { gte: scopeStart, lte: scopeEnd } },
      { due_date: { gte: scopeStart, lte: scopeEnd } },
      { payment_date: { gte: scopeStart, lte: scopeEnd } }
    ];

    const orPrevScope = [
      { created_at: { gte: prevStart, lte: prevEnd } },
      { due_date: { gte: prevStart, lte: prevEnd } },
      { payment_date: { gte: prevStart, lte: prevEnd } }
    ];

    const [pending, overdue, sentThisMonth, total, paid, yesterdayPending] = await Promise.all([
      this.prisma.charge.aggregate({ where: { creditor_id: userId, status: 'PENDING', due_date: { gte: scopeStart, lte: scopeEnd } }, _sum: { amount: true } }),
      this.prisma.charge.aggregate({ where: { creditor_id: userId, status: 'OVERDUE', due_date: { gte: scopeStart, lte: scopeEnd } }, _sum: { amount: true } }),
      this.prisma.charge.count({ where: { creditor_id: userId, created_at: { gte: startOfMonth, lte: scopeEnd } } }),
      this.prisma.charge.count({ where: { creditor_id: userId, status: { in: ['PAID', 'PENDING', 'OVERDUE'] }, due_date: { gte: scopeStart, lte: scopeEnd } } }),
      this.prisma.charge.count({ where: { creditor_id: userId, status: 'PAID', payment_date: { gte: scopeStart, lte: scopeEnd } } }),
      this.prisma.charge.aggregate({
        where: { creditor_id: userId, status: 'PENDING', due_date: { gte: prevStart, lte: prevEnd } },
        _sum: { amount: true }
      })
    ]);

    const amountToday = pending._sum.amount || 0;
    const amountYesterday = yesterdayPending._sum.amount || 0;
    const variation = amountYesterday > 0 ? ((amountToday - amountYesterday) / amountYesterday) * 100 : (amountToday > 0 ? 100 : 0);
    const conversionRate = total > 0 ? (paid / total) * 100 : 0;

    return {
      totalPending: amountToday,
      pendingVariation: variation > 0 ? `+${variation.toFixed(1)}%` : `${variation.toFixed(1)}%`,
      totalOverdue: overdue._sum.amount || 0,
      sentThisMonth,
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

  private async getTopClients(userId: string, scopeStart: Date, scopeEnd: Date) {
    const raw = await this.prisma.charge.groupBy({
      by: ['debtor_id'], 
      where: { 
        creditor_id: userId, 
        due_date: { gte: scopeStart, lte: scopeEnd }
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
    const data: { label: string; amount: number; count: number; date: string; isToday: boolean }[] = [];
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
        const dateStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
        const isToday = now >= start && now <= end;
        data.push({ label: weeks[i], amount, count: agg._count, date: dateStr, isToday });
      }
    } else {
      const dayNames = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
      const currentDay = now.getDay(); // 0 is Sunday
      for (let i = 0; i <= 6; i++) {
        const start = new Date(now);
        // Shift to Sunday of this week, then add i days
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
        const dateStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
        data.push({ label: dayNames[i], amount, count: agg._count, date: dateStr, isToday });
      }
    }
    
    return data.map(d => ({ ...d, heightPercentage: d.amount === 0 ? 5 : Math.max(10, Math.floor((d.amount / max) * 100)) }));
  }

  private async getRecentActivity(userId: string, statusFilter?: string, scopeStart?: Date, scopeEnd?: Date) {
    const validStatus = statusFilter && ['PENDING', 'PAID', 'OVERDUE', 'CANCELED'].includes(statusFilter) ? statusFilter : undefined;
    const start = scopeStart || new Date(new Date().setHours(0, 0, 0, 0));
    const end = scopeEnd || new Date(new Date().setHours(23, 59, 59, 999));
    
    const charges = await this.prisma.charge.findMany({
      where: { 
        creditor_id: userId, 
        ...(validStatus && { status: validStatus as any }),
        due_date: { gte: start, lte: end }
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
