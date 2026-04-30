import { Module } from '@nestjs/common';
import { AutomationService } from './automation.service';

import { PrismaModule } from '../prisma/prisma.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [PrismaModule, WhatsAppModule],
  providers: [AutomationService]
})
export class AutomationModule {}
