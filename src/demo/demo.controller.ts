import { Body, Controller, Post, Request } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { DemoService } from './demo.service';
import { SendDemoDto } from './dto/send-demo.dto';

@Controller('demo')
export class DemoController {
  constructor(private readonly demoService: DemoService) {}

  // 5 tentativas por 15 min por IP — proteção além do bloqueio por DemoAttempt
  @Post('send')
  @Throttle({ default: { ttl: 900000, limit: 5 } })
  async send(@Body() dto: SendDemoDto, @Request() req) {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      req.ip ??
      '';
    return this.demoService.sendDemo(ip, dto.phone, dto.name, dto.message);
  }
}
