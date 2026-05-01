import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { IntegrationsService } from './integrations.service';
import { IntegrationsController } from './integrations.controller';
import { AsaasService } from './asaas.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AsaasWebhookController } from './asaas-webhook.controller';
import { SubscriptionModule } from '../subscription/subscription.module';

@Module({
  imports: [
    PrismaModule, 
    HttpModule, 
    ConfigModule,
    forwardRef(() => SubscriptionModule),
  ],
  controllers: [IntegrationsController, AsaasWebhookController],
  providers: [IntegrationsService, AsaasService],
  exports: [IntegrationsService, AsaasService],
})
export class IntegrationsModule { }
