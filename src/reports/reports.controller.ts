import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PlanGuard } from '../common/plan.guard';
import { RequiresModule } from '../common/requires-module.decorator';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(AuthGuard('jwt'), PlanGuard)
@RequiresModule('REPORTS')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('summary')
  getSummary(@Request() req) {
    return this.reportsService.getSummary(req.user.id);
  }

  @Get('customers')
  getCustomers(@Request() req) {
    return this.reportsService.getCustomerRanking(req.user.id);
  }

  @Get('performance')
  getPerformance(@Request() req) {
    return this.reportsService.getRecoveryPerformance(req.user.id);
  }
}
