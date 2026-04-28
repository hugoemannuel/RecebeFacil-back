import { IsString, MinLength, MaxLength, Matches } from 'class-validator';

export class SendDemoDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @IsString()
  @Matches(/^\+?[1-9]\d{9,14}$/, { message: 'Telefone inválido' })
  phone: string;

  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  message: string;
}
