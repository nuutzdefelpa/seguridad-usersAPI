import {
  IsDateString,
  IsEmail,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsString()
  usuario: string;

  @IsString()
  fullName: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(10)
  @Matches(/[A-Z]/, { message: 'password must contain at least one uppercase letter' })
  @Matches(/[a-z]/, { message: 'password must contain at least one lowercase letter' })
  @Matches(/[0-9]/, { message: 'password must contain at least one digit' })
  @Matches(/[!@#$%^&*(),.?":{}|<>]/, {
    message: 'password must contain at least one special character',
  })
  password: string;

  @IsDateString()
  dob: string;

  @IsString()
  phone: string;

  @IsString()
  address: string;
}