import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @UseGuards(JwtAuthGuard)
  @Get('asaas/split-terms')
  async getSplitTerms() {
    return await this.integrationsService.getSplitTerms();
  }

  @UseGuards(JwtAuthGuard)
  @Post('asaas/acknowledge-split')
  async acknowledgeSplit(@Req() req, @Body() data: any) {
    return await this.integrationsService.acknowledgeSplitTerms(req.user.id, data);
  }
}
