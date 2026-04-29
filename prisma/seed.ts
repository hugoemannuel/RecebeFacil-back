import * as dotenv from 'dotenv';
dotenv.config();

import { PrismaClient, PlanType, SubStatus, SubPeriod } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const user = await prisma.user.findFirst({
    where: { is_registered: true },
    select: { id: true, name: true, email: true },
  });

  if (!user) {
    console.log('Nenhum usuário registrado encontrado. Cadastre-se primeiro.');
    return;
  }

  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setFullYear(periodEnd.getFullYear() + 1);

  const sub = await prisma.subscription.upsert({
    where: { user_id: user.id },
    update: {
      plan_type: PlanType.UNLIMITED,
      status: SubStatus.ACTIVE,
      period: SubPeriod.YEARLY,
      current_period_start: now,
      current_period_end: periodEnd,
    },
    create: {
      user_id: user.id,
      plan_type: PlanType.UNLIMITED,
      status: SubStatus.ACTIVE,
      period: SubPeriod.YEARLY,
      current_period_start: now,
      current_period_end: periodEnd,
    },
  });

  console.log(`Plano UNLIMITED YEARLY atribuído a ${user.name} (${user.email})`);
  console.log(`Válido até: ${periodEnd.toLocaleDateString('pt-BR')}`);
  console.log(`Subscription ID: ${sub.id}`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
