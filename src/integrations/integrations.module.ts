import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { IntegrationsService } from './integrations.service';
import { IntegrationsController } from './integrations.controller';
import { AsaasService } from './asaas.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule, HttpModule, ConfigModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsService, AsaasService],
  exports: [IntegrationsService, AsaasService],
})
export class IntegrationsModule { }
