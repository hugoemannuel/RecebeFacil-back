import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { ZapiWebhookService } from './zapi-webhook.service';
import { ZapiMessageDto } from './dto/zapi-message.dto';

@Public()
@Controller('webhooks')
export class ZapiWebhookController {
  constructor(private readonly service: ZapiWebhookService) {}

  @Post('zapi')
  @HttpCode(200)
  async handle(@Body() body: ZapiMessageDto): Promise<{ ok: boolean }> {
    await this.service.handle(body);
    return { ok: true };
  }
}
