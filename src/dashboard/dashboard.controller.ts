import { Controller, Get, UseGuards, Request, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { AuthGuard } from '@nestjs/passport';

@Controller('dashboard')
@UseGuards(AuthGuard('jwt'))
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('metrics')
  async getMetrics(@Request() req, @Query('period') period?: string, @Query('status') status?: string, @Query('targetDate') targetDate?: string) {
    const validStatus = status && ['PENDING', 'PAID', 'OVERDUE', 'CANCELED'].includes(status) ? status : undefined;
    const metrics = await this.dashboardService.getMetrics(req.user.id, period, validStatus, targetDate);
    return { ...metrics, user: { name: req.user.name } };
  }
}
