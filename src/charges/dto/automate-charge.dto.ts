import { IsEnum, IsOptional, IsString, IsNotEmpty } from 'class-validator';

export class AutomateChargeDto {
  @IsEnum(['WEEKLY', 'MONTHLY', 'YEARLY'])
  frequency: string;

  @IsString()
  @IsNotEmpty()
  next_generation_date: string;

  @IsOptional()
  @IsString()
  custom_message?: string;
}
