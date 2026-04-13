import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { IntOpCode } from '../common/decorators/operation-code.decorator';
import { SupabaseAuthGuard } from '../common/guards/supabase-auth.guard';
import type { CurrentUser as CurrentUserType } from '../common/interfaces/current-user.interface';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@UseGuards(SupabaseAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @IntOpCode('USERS_LIST')
  listUsers(@CurrentUser() currentUser: CurrentUserType) {
    return this.usersService.listUsers(currentUser);
  }

  @Get(':userId')
  @IntOpCode('USERS_GET')
  getUser(@CurrentUser() currentUser: CurrentUserType, @Param('userId') userId: string) {
    return this.usersService.getUser(currentUser, userId);
  }

  @Post()
  @HttpCode(201)
  @IntOpCode('USERS_CREATE')
  createUser(@CurrentUser() currentUser: CurrentUserType, @Body() dto: CreateUserDto) {
    return this.usersService.createUser(currentUser, dto);
  }

  @Patch(':userId')
  @IntOpCode('USERS_UPDATE')
  updateUser(
    @CurrentUser() currentUser: CurrentUserType,
    @Param('userId') userId: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.updateUser(currentUser, userId, dto);
  }

  @Delete(':userId')
  @IntOpCode('USERS_DELETE')
  deleteUser(@CurrentUser() currentUser: CurrentUserType, @Param('userId') userId: string) {
    return this.usersService.deleteUser(currentUser, userId);
  }
}
