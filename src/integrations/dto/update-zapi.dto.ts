import { IsString, IsNotEmpty } from 'class-validator';

export class UpdateZapiDto {
  @IsString()
  @IsNotEmpty()
  instance_id: string;

  @IsString()
  @IsNotEmpty()
  instance_token: string;
}
