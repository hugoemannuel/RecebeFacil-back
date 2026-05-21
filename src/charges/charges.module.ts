import { Module, forwardRef } from '@nestjs/common';
import { ChargesService } from './charges.service';
import { ChargesController } from './charges.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ClientsModule } from '../clients/clients.module';
import { QueueModule } from '../queue/queue.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [PrismaModule, ClientsModule, QueueModule, forwardRef(() => IntegrationsModule), WhatsAppModule],
  controllers: [ChargesController],
  providers: [ChargesService],
  exports: [ChargesService],
})
export class ChargesModule {}
