import { IsEnum, IsOptional, IsString } from 'class-validator';

export class UpdateRecurringChargeDto {
  @IsOptional()
  @IsEnum(['WEEKLY', 'MONTHLY', 'YEARLY'])
  frequency?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  next_generation_date?: string;

  @IsOptional()
  @IsString()
  custom_message?: string;
}
