import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { IntOpCode } from '../common/decorators/operation-code.decorator';
import type { CurrentUser as CurrentUserType } from '../common/interfaces/current-user.interface';
import { SupabaseAuthGuard } from '../common/guards/supabase-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(201)
  @IntOpCode('AUTH_REGISTER')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(200)
  @IntOpCode('AUTH_LOGIN')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @UseGuards(SupabaseAuthGuard)
  @Get('me')
  @IntOpCode('AUTH_ME')
  me(@CurrentUser() currentUser: CurrentUserType) {
    return this.authService.getMe(currentUser);
  }
}