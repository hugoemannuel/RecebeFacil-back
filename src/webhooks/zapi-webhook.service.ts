import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ZapiMessageDto } from './dto/zapi-message.dto';

const OPT_OUT_KEYWORDS = ['PARAR', 'STOP', 'CANCELAR', 'DESCADASTRAR', 'SAIR'];

@Injectable()
export class ZapiWebhookService {
  private readonly logger = new Logger(ZapiWebhookService.name);

  constructor(private readonly prisma: PrismaService) {}

  async handle(payload: ZapiMessageDto): Promise<void> {
    if (payload.fromMe) return;
    if (payload.type !== 'ReceivedCallback') return;

    const rawMessage = payload.text?.message?.trim().toUpperCase() ?? '';
    if (!OPT_OUT_KEYWORDS.includes(rawMessage)) return;

    const phone = payload.phone.replace(/@c\.us$/, '').replace(/@s\.whatsapp\.net$/, '');

    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user) {
      this.logger.debug(`Opt-out recebido de número não cadastrado: ${phone}`);
      return;
    }

    if (user.whatsapp_opted_out) {
      this.logger.debug(`Usuário ${user.id} já está com opt-out ativo`);
      return;
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { whatsapp_opted_out: true },
    });

    await this.prisma.auditLog.create({
      data: {
        user_id: user.id,
        action: 'WHATSAPP_OPT_OUT',
        entity: 'User',
        entity_id: user.id,
        details: { keyword: rawMessage, phone },
      },
    });

    this.logger.log(`Opt-out registrado: usuário ${user.id} (${phone})`);
  }
}
