import { IsNumber, IsString, IsNotEmpty, IsIn, Min } from 'class-validator';

export class WithdrawDto {
  @IsNumber()
  @Min(0.01)
  value: number;

  @IsString()
  @IsNotEmpty()
  pixKey: string;

  @IsIn(['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'EVP'])
  pixKeyType: string;
}
