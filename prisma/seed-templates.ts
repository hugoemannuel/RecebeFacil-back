import * as dotenv from 'dotenv';
dotenv.config();

import { PrismaClient, MessageTrigger } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const SYSTEM_TEMPLATES = [
  {
    name: 'Cobrança Inicial',
    trigger: MessageTrigger.MANUAL,
    body: `Olá *{{nome}}*! 👋\n\nPassando para lembrar da sua cobrança:\n\n💰 Valor: *{{valor}}*\n📅 Vencimento: *{{vencimento}}*\n📝 Referência: {{descricao}}\n\nPara pagar via PIX, clique no botão abaixo! ✅`,
    is_default: true,
  },
  {
    name: 'Lembrete Amigável',
    trigger: MessageTrigger.BEFORE_DUE,
    body: `Oi *{{nome}}*! 😊\n\nSua cobrança de *{{valor}}* vence em *{{vencimento}}*.\n\nPague via PIX rapidinho! 💳`,
    is_default: false,
  },
  {
    name: 'Urgente',
    trigger: MessageTrigger.OVERDUE,
    body: `⚠️ *{{nome}}*, sua cobrança de *{{valor}}* vence *hoje*!\n\nEvite atrasos — pague agora via PIX.`,
    is_default: false,
  },
];

async function main() {
  const profiles = await prisma.creditorProfile.findMany();
  console.log(`Encontrados ${profiles.length} perfis para seed de templates.`);

  for (const profile of profiles) {
    const count = await prisma.messageTemplate.count({
      where: { creditor_profile_id: profile.id },
    });

    if (count === 0) {
      console.log(`Semeando templates para o perfil: ${profile.id}`);
      for (const t of SYSTEM_TEMPLATES) {
        await prisma.messageTemplate.create({
          data: {
            creditor_profile_id: profile.id,
            name: t.name,
            trigger: t.trigger,
            body: t.body,
            is_default: t.is_default,
          },
        });
      }
    } else {
      console.log(`Perfil ${profile.id} já possui templates. Pulando.`);
    }
  }

  console.log('Seed de templates finalizado com sucesso!');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
