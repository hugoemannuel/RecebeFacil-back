import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { PgBossService } from './pg-boss.service';
import { NotificationWorker } from './notification.worker';

@Module({
  imports: [PrismaModule, WhatsAppModule],
  providers: [PgBossService, NotificationWorker],
  exports: [PgBossService],
})
export class QueueModule {}
