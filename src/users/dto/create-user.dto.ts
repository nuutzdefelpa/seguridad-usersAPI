import { IsArray, IsOptional, IsString } from 'class-validator';
import { RegisterDto } from '../../auth/dto/register.dto';

export class CreateUserDto extends RegisterDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];
}
