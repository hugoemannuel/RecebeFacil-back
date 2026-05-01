import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateAutomationDto {
  @IsOptional()
  @IsBoolean()
  allows_automation?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  automation_days_before?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  automation_days_after?: number;
}
