import { MessageTrigger } from '@prisma/client';

export const SYSTEM_TEMPLATES = [
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
