import { Controller, Get, Post, Body, UseGuards, Request } from '@nestjs/common';
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
}
