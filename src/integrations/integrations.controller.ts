import { Controller, Get, Post, Body, UseGuards, Req, Patch, Delete, HttpCode, HttpStatus, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IntegrationsService } from './integrations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UpdateAutomationDto } from './dto/update-automation.dto';
import { UpdateZapiDto } from './dto/update-zapi.dto';
import { WithdrawDto } from './dto/withdraw.dto';

@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @UseGuards(JwtAuthGuard)
  @Get('finance/balance')
  async getFinanceBalance(@Req() req) {
    return this.integrationsService.getFinanceBalance(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('finance/withdraw')
  @Throttle({ default: { ttl: 60000, limit: 1 } })
  async requestWithdrawal(@Req() req, @Body() dto: WithdrawDto) {
    return this.integrationsService.requestWithdrawal(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('finance/withdrawals')
  async getWithdrawals(
    @Req() req,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.integrationsService.getWithdrawals(req.user.id, Number(page) || 1, Number(limit) || 10);
  }

  @UseGuards(JwtAuthGuard)
  @Get('split-status')
  async getSplitStatus(@Req() req) {
    return this.integrationsService.getSplitStatus(req.user.id);
  }

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
  @Get('zapi')
  async getZapi(@Req() req) {
    return this.integrationsService.getZapiConfig(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('zapi')
  async updateZapi(@Req() req, @Body() dto: UpdateZapiDto) {
    return this.integrationsService.updateZapiConfig(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('zapi')
  @HttpCode(HttpStatus.NO_CONTENT)
  async disconnectZapi(@Req() req) {
    await this.integrationsService.disconnectZapi(req.user.id);
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
