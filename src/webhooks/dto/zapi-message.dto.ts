import { IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

class ZapiTextDto {
  @IsString() @IsOptional() message?: string;
}

export class ZapiMessageDto {
  @IsString() phone: string;
  @IsString() @IsOptional() instanceId?: string;
  @IsString() type: string;
  @IsBoolean() fromMe: boolean;
  @IsObject() @IsOptional() @Type(() => ZapiTextDto) text?: ZapiTextDto;
}
