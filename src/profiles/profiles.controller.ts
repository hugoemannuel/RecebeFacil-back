import { Controller, Get, Patch, Body, UseGuards, Request } from '@nestjs/common';
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
}
