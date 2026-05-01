import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';

import { DashboardModule } from './dashboard/dashboard.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { ChargesModule } from './charges/charges.module';
import { ClientsModule } from './clients/clients.module';
import { DemoModule } from './demo/demo.module';
import { ProfilesModule } from './profiles/profiles.module';
import { ReportsModule } from './reports/reports.module';
import { ScheduleModule } from '@nestjs/schedule';
import { AutomationModule } from './automation/automation.module';
import { IntegrationsModule } from './integrations/integrations.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 100,
    }]),
    PrismaModule, 
    UsersModule, 
    AuthModule,
    DashboardModule,
    SubscriptionModule,
    ChargesModule,
    ClientsModule,
    DemoModule,
    ProfilesModule,
    ReportsModule,
    AutomationModule,
    IntegrationsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
