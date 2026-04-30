import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@Injectable()
export class ClientsService {
  constructor(private prisma: PrismaService) {}

  async findAll(creditorId: string) {
    const clients = await this.prisma.client.findMany({
      where: { creditor_id: creditorId },
      include: { user: true },
      orderBy: { created_at: 'desc' },
    });

    if (clients.length === 0) return [];

    const userIds = clients.map(c => c.user_id);

    const [chargeStats, pendingStats] = await Promise.all([
      this.prisma.charge.groupBy({
        by: ['debtor_id'],
        where: { creditor_id: creditorId, debtor_id: { in: userIds } },
        _count: { id: true },
      }),
      this.prisma.charge.groupBy({
        by: ['debtor_id'],
        where: { creditor_id: creditorId, debtor_id: { in: userIds }, status: { in: ['PENDING', 'OVERDUE'] } },
        _sum: { amount: true },
      }),
    ]);

    return clients.map(c => {
      const stats = chargeStats.find(s => s.debtor_id === c.user_id);
      const pending = pendingStats.find(s => s.debtor_id === c.user_id);
      const name = c.user.name;
      const parts = name.trim().split(' ');
      return {
        id: c.id,
        userId: c.user_id,
        name,
        phone: c.user.phone,
        email: c.user.email ?? null,
        notes: c.notes ?? null,
        initials: parts.length > 1
          ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
          : name.substring(0, 2).toUpperCase(),
        totalCharges: stats?._count.id ?? 0,
        totalPending: pending?._sum.amount ?? 0,
        createdAt: c.created_at,
      };
    });
  }

  async findOne(creditorId: string, clientId: string) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      include: { user: true },
    });

    if (!client || client.creditor_id !== creditorId) {
      throw new NotFoundException('Cliente não encontrado.');
    }

    const charges = await this.prisma.charge.findMany({
      where: { creditor_id: creditorId, debtor_id: client.user_id },
      orderBy: { created_at: 'desc' },
    });

    const name = client.user.name;
    const parts = name.trim().split(' ');

    return {
      id: client.id,
      userId: client.user_id,
      name,
      phone: client.user.phone,
      email: client.user.email ?? null,
      notes: client.notes ?? null,
      initials: parts.length > 1
        ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
        : name.substring(0, 2).toUpperCase(),
      createdAt: client.created_at,
      charges: charges.map(ch => ({
        id: ch.id,
        amount: ch.amount,
        dueDate: ch.due_date,
        status: ch.status,
        description: ch.description,
      })),
    };
  }

  async create(creditorId: string, dto: CreateClientDto) {
    let user = await this.prisma.user.findUnique({ where: { phone: dto.phone } });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          phone: dto.phone,
          name: dto.name,
          email: dto.email ?? undefined,
          is_registered: false,
        },
      });
    }

    const client = await this.prisma.client.upsert({
      where: { creditor_id_user_id: { creditor_id: creditorId, user_id: user.id } },
      update: { notes: dto.notes ?? undefined },
      create: { creditor_id: creditorId, user_id: user.id, notes: dto.notes ?? undefined },
      include: { user: true },
    });

    await this.prisma.auditLog.create({
      data: {
        user_id: creditorId,
        action: 'CLIENT_CREATED',
        entity: 'Client',
        entity_id: client.id,
      },
    });

    return { success: true, clientId: client.id };
  }

  async update(creditorId: string, clientId: string, dto: UpdateClientDto) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      include: { user: true },
    });

    if (!client || client.creditor_id !== creditorId) {
      throw new NotFoundException('Cliente não encontrado.');
    }

    await this.prisma.client.update({
      where: { id: clientId },
      data: { notes: dto.notes ?? undefined },
    });

    if (dto.name || dto.email) {
      await this.prisma.user.update({
        where: { id: client.user_id },
        data: {
          ...(dto.name && { name: dto.name }),
          ...(dto.email && { email: dto.email }),
        },
      });
    }

    return { success: true };
  }

  async remove(creditorId: string, clientId: string) {
    const client = await this.prisma.client.findUnique({ where: { id: clientId } });

    if (!client || client.creditor_id !== creditorId) {
      throw new NotFoundException('Cliente não encontrado.');
    }

    await this.prisma.client.delete({ where: { id: clientId } });

    await this.prisma.auditLog.create({
      data: {
        user_id: creditorId,
        action: 'CLIENT_REMOVED',
        entity: 'Client',
        entity_id: clientId,
      },
    });

    return { success: true };
  }

  // Chamado pelo ChargesService ao criar cobrança para manter a lista sincronizada.
  async upsertFromCharge(creditorId: string, debtorId: string) {
    await this.prisma.client.upsert({
      where: { creditor_id_user_id: { creditor_id: creditorId, user_id: debtorId } },
      update: {},
      create: { creditor_id: creditorId, user_id: debtorId },
    });
  }
}
