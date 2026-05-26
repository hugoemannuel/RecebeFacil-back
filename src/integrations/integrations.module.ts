import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { IntegrationsService } from './integrations.service';
import { IntegrationsController } from './integrations.controller';
import { AsaasService } from './asaas.service';
import { CryptoService } from '../common/crypto.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AsaasWebhookController } from './asaas-webhook.controller';
import { AsaasWebhookWorker } from './asaas-webhook.worker';
import { SubscriptionModule } from '../subscription/subscription.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [
    PrismaModule,
    HttpModule,
    ConfigModule,
    QueueModule,
    forwardRef(() => SubscriptionModule),
  ],
  controllers: [IntegrationsController, AsaasWebhookController],
  providers: [IntegrationsService, AsaasService, CryptoService, AsaasWebhookWorker],
  exports: [IntegrationsService, AsaasService],
})
export class IntegrationsModule { }
