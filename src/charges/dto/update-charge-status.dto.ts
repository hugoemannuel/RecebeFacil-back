import { IsEnum } from 'class-validator';

export class UpdateChargeStatusDto {
  @IsEnum(['PENDING', 'PAID', 'OVERDUE', 'CANCELED'])
  status: 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELED';
}
