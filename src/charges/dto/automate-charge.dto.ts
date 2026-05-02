import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class AutomateChargeDto {
  @IsEnum(['WEEKLY', 'MONTHLY', 'YEARLY'])
  frequency: string;

  @IsString()
  @IsNotEmpty()
  next_generation_date: string;

  @IsOptional()
  @IsString()
  custom_message?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  max_installments?: number;
}
