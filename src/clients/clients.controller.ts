import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { PlanGuard } from '../common/plan.guard';
import { RequiresModule } from '../common/requires-module.decorator';

@Controller('clients')
@UseGuards(AuthGuard('jwt'), PlanGuard)
@RequiresModule('CLIENTS')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  findAll(@Request() req) {
    return this.clientsService.findAll(req.user.id);
  }

  @Get(':id')
  findOne(@Request() req, @Param('id') id: string) {
    return this.clientsService.findOne(req.user.id, id);
  }

  @Post()
  create(@Request() req, @Body() dto: CreateClientDto) {
    return this.clientsService.create(req.user.id, dto);
  }

  @Patch(':id')
  update(@Request() req, @Param('id') id: string, @Body() dto: UpdateClientDto) {
    return this.clientsService.update(req.user.id, id, dto);
  }

  @Delete(':id')
  remove(@Request() req, @Param('id') id: string) {
    return this.clientsService.remove(req.user.id, id);
  }
}
