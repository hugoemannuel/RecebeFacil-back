import { IsNumber, IsString, IsNotEmpty, IsIn, Min, IsUUID, MaxLength } from 'class-validator';

export class WithdrawDto {
  @IsNumber()
  @Min(0.10)
  value: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  pixKey: string;

  @IsIn(['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'EVP'])
  pixKeyType: string;

  @IsString()
  @IsUUID()
  idempotencyKey: string;
}
