import { Controller, Get, Patch, Post, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ProfilesService } from './profiles.service';

@Controller('profiles')
@UseGuards(AuthGuard('jwt'))
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  @Get('me')
  async getProfile(@Request() req) {
    return this.profilesService.getProfile(req.user.id);
  }

  @Patch('me')
  async updateProfile(@Request() req, @Body() dto: any) {
    return this.profilesService.updateProfile(req.user.id, dto);
  }

  // ==========================================
  // TEMPLATES
  // ==========================================

  @Get('me/templates')
  async getTemplates(@Request() req) {
    return this.profilesService.getTemplates(req.user.id);
  }

  @Post('me/templates')
  async createTemplate(@Request() req, @Body() dto: any) {
    return this.profilesService.createTemplate(req.user.id, dto);
  }

  @Patch('me/templates/:id')
  async updateTemplate(@Request() req, @Param('id') id: string, @Body() dto: any) {
    return this.profilesService.updateTemplate(req.user.id, id, dto);
  }

  @Delete('me/templates/:id')
  async deleteTemplate(@Request() req, @Param('id') id: string) {
    return this.profilesService.deleteTemplate(req.user.id, id);
  }
}

