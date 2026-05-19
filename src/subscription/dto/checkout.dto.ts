import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PlanType } from '@prisma/client';

export class CheckoutDto {
  @IsEnum(PlanType)
  planType: PlanType;

  @IsEnum(['MONTHLY', 'YEARLY'])
  period: 'MONTHLY' | 'YEARLY';

  @IsOptional()
  @IsString()
  @MaxLength(18)
  document?: string;
}
