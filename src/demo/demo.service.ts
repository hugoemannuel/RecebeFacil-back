import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

@Injectable()
export class DemoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  async sendDemo(
    ip: string,
    phone: string,
    name: string,
    message: string,
  ): Promise<{ sent: boolean; blocked: boolean }> {
    const ipHash = createHash('sha256').update(ip).digest('hex');

    const existing = await this.prisma.demoAttempt.findUnique({ where: { ipHash } });
    if (existing) return { sent: false, blocked: true };

    const finalMessage = message.replace(/\{\{nome\}\}/g, name);

    await this.whatsapp.sendText(phone, finalMessage);
    await this.prisma.demoAttempt.create({ data: { ipHash } });

    return { sent: true, blocked: false };
  }
}
