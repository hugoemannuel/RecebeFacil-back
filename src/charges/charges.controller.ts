import { Controller, Get, Post, Delete, Param, Body, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ChargesService } from './charges.service';
import { CreateChargeDto } from './dto/create-charge.dto';

@Controller('charges')
@UseGuards(AuthGuard('jwt'))
export class ChargesController {
  constructor(private readonly chargesService: ChargesService) {}

  @Get()
  async findAll(@Request() req) {
    return this.chargesService.findAll(req.user.id);
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

  @Delete(':id')
  async deleteCharge(@Request() req, @Param('id') id: string) {
    return this.chargesService.cancelCharge(req.user.id, id);
  }
}
