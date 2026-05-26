import { Controller, Get, Post, HttpCode, Body, Headers, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PgBossService, WEBHOOK_ASAAS_QUEUE } from '../queue/pg-boss.service';
import { Public } from '../auth/decorators/public.decorator';

@Controller('integrations/asaas')
export class AsaasWebhookController {
  private readonly logger = new Logger(AsaasWebhookController.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly pgBoss: PgBossService,
  ) {}

  @Get('webhook')
  @Public()
  pingWebhook() {
    return { status: 'ok' };
  }

  @Post('webhook')
  @Public()
  @HttpCode(200)
  async handleWebhook(
    @Body() body: any,
    @Headers('asaas-access-token') token: string,
  ) {
    const secret = this.configService.get<string>('ASAAS_WEBHOOK_SECRET');

    if (!token || token !== secret) {
      this.logger.warn('Webhook Asaas rejeitado: token inválido');
      throw new UnauthorizedException('Invalid webhook token');
    }

    const eventType: string = body?.event ?? 'UNKNOWN';
    const fingerprint = this.computeFingerprint(body);

    // Verificar idempotência — se já processado, ignorar silenciosamente
    const existing = await this.prisma.webhookEvent.findUnique({
      where: { asaas_event_id: fingerprint },
      select: { id: true, processed: true },
    });

    if (existing?.processed) {
      this.logger.log(`Webhook duplicado ignorado: ${fingerprint} (${eventType})`);
      return { received: true, duplicate: true };
    }

    // Salvar evento antes de responder — garante rastreabilidade mesmo se worker cair
    const webhookEvent = await this.prisma.webhookEvent.upsert({
      where: { asaas_event_id: fingerprint },
      update: {},
      create: {
        source: 'ASAAS',
        event_type: eventType,
        asaas_event_id: fingerprint,
        payload: body,
      },
    });

    // Enfileirar para processamento assíncrono
    await this.pgBoss.send(WEBHOOK_ASAAS_QUEUE, { webhookEventId: webhookEvent.id });

    this.logger.log(`Webhook Asaas enfileirado. Evento: ${eventType}, ID: ${webhookEvent.id}`);
    return { received: true };
  }

  private computeFingerprint(body: any): string {
    const entityId =
      body.payment?.id ??
      body.subscription?.id ??
      body.transfer?.id ??
      'unknown';
    const key = `${body.event ?? 'UNKNOWN'}:${entityId}`;
    return createHash('sha256').update(key).digest('hex');
  }
}
