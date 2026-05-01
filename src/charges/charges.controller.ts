import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ChargesService } from './charges.service';
import { CreateChargeDto } from './dto/create-charge.dto';
import { UpdateRecurringChargeDto } from './dto/update-recurring-charge.dto';
import { UpdateChargeStatusDto } from './dto/update-charge-status.dto';

@Controller('charges')
@UseGuards(AuthGuard('jwt'))
export class ChargesController {
  constructor(private readonly chargesService: ChargesService) {}

  @Get()
  async findAll(@Request() req) {
    return this.chargesService.findAll(req.user.id);
  }
 
  @Get('recurring')
  async findAllRecurring(@Request() req) {
    return this.chargesService.findAllRecurring(req.user.id);
  }

  @Get('recurring/:id')
  async findOneRecurring(@Request() req, @Param('id') id: string) {
    return this.chargesService.findOneRecurring(req.user.id, id);
  }

  @Get(':id')
  async findOne(@Request() req, @Param('id') id: string) {
    return this.chargesService.findOne(req.user.id, id);
  }

  @Post()
  async createCharge(@Request() req, @Body() createChargeDto: CreateChargeDto) {
    return this.chargesService.createCharge(req.user.id, createChargeDto);
  }

  @Post('bulk/cancel')
  async bulkCancel(@Request() req, @Body() body: { chargeIds: string[] }) {
    return this.chargesService.bulkCancel(req.user.id, body.chargeIds);
  }

  @Post('bulk/remind')
  async bulkRemind(@Request() req, @Body() body: { chargeIds: string[] }) {
    return this.chargesService.bulkRemind(req.user.id, body.chargeIds);
  }

  @Delete('permanent/:id')
  async hardDeleteCharge(@Request() req, @Param('id') id: string) {
    return this.chargesService.hardDeleteCharge(req.user.id, id);
  }

  @Delete('recurring/:id')
  async deleteRecurring(@Request() req, @Param('id') id: string) {
    return this.chargesService.deleteRecurring(req.user.id, id);
  }

  @Delete(':id')
  async deleteCharge(@Request() req, @Param('id') id: string) {
    return this.chargesService.cancelCharge(req.user.id, id);
  }

  @Post('recurring/:id/cancel')
  async cancelRecurring(@Request() req, @Param('id') id: string) {
    return this.chargesService.cancelRecurring(req.user.id, id);
  }

  @Post('recurring/:id/reactivate')
  async reactivateRecurring(@Request() req, @Param('id') id: string) {
    return this.chargesService.reactivateRecurring(req.user.id, id);
  }

  @Patch(':id/status')
  async updateStatus(@Request() req, @Param('id') id: string, @Body() dto: UpdateChargeStatusDto) {
    return this.chargesService.updateChargeStatus(req.user.id, id, dto.status);
  }

  @Patch('recurring/:id')
  async updateRecurring(@Request() req, @Param('id') id: string, @Body() dto: UpdateRecurringChargeDto) {
    return this.chargesService.updateRecurring(req.user.id, id, dto);
  }
}
