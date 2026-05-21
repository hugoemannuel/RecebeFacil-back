import { IsIn } from 'class-validator';

export class NotifyNowDto {
  @IsIn(['BEFORE_DUE', 'ON_DUE', 'OVERDUE'])
  trigger: 'BEFORE_DUE' | 'ON_DUE' | 'OVERDUE';
}
