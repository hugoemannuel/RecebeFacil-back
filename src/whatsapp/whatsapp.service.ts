import { Injectable, Logger } from '@nestjs/common';

export interface ZApiCredentials {
  instanceId: string;
  token: string;
  clientToken: string;
}

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  async sendText(phone: string, message: string, credentials?: ZApiCredentials): Promise<void> {
    const instanceId  = credentials?.instanceId  ?? process.env.ZAPI_INSTANCE_ID;
    const token       = credentials?.token       ?? process.env.ZAPI_INSTANCE_TOKEN;
    const clientToken = credentials?.clientToken ?? process.env.ZAPI_CLIENT_TOKEN;

    if (!instanceId || !token || !clientToken) {
      this.logger.warn(`[mock] sendText → ${phone}: ${message.slice(0, 60)}...`);
      return;
    }

    const url = `https://api.z-api.io/instances/${instanceId}/token/${token}/send-text`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Token': clientToken,
      },
      body: JSON.stringify({ phone, message }),
    });

    if (!res.ok) {
      this.logger.error(`Z-API send-text failed: status ${res.status}`);
      throw new Error('Falha ao enviar mensagem');
    }
  }
}
