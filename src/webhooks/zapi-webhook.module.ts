import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ZapiWebhookController } from './zapi-webhook.controller';
import { ZapiWebhookService } from './zapi-webhook.service';

@Module({
  imports: [PrismaModule],
  controllers: [ZapiWebhookController],
  providers: [ZapiWebhookService],
})
export class ZapiWebhookModule {}
