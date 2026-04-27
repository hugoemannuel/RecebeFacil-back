import { IsString, IsNotEmpty, IsNumber, Min, IsEnum, IsBoolean, IsOptional, MaxLength } from 'class-validator';

export class CreateChargeDto {
  @IsString()
  @IsNotEmpty()
  debtor_name: string;

  @IsString()
  @IsNotEmpty()
  debtor_phone: string;

  @IsNumber()
  @Min(100)
  amount: number;

  @IsString()
  @IsNotEmpty()
  due_date: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  description: string;

  @IsEnum(['ONCE', 'WEEKLY', 'MONTHLY', 'YEARLY'])
  recurrence: string;

  @IsString()
  @IsNotEmpty()
  custom_message: string;

  @IsBoolean()
  send_pix_button: boolean;

  @IsOptional()
  @IsString()
  pix_key?: string;

  @IsOptional()
  @IsEnum(['CPF', 'CNPJ', 'PHONE', 'EMAIL', 'EVP'])
  pix_key_type?: string;
}
