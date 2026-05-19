import { Controller, Get, Post, Body, UseGuards, Req, Patch } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UpdateAutomationDto } from './dto/update-automation.dto';

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

  @UseGuards(JwtAuthGuard)
  @Get('automation')
  async getAutomation(@Req() req) {
    return await this.integrationsService.getAutomationConfig(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('automation')
  async updateAutomation(@Req() req, @Body() dto: UpdateAutomationDto) {
    return await this.integrationsService.updateAutomationConfig(req.user.id, dto);
  }
}
