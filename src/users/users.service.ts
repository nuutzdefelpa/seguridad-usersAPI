import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { RegisterDto } from '../auth/dto/register.dto';
import { AuthService } from '../auth/auth.service';
import type { AppUserProfileRecord, CurrentUser } from '../common/interfaces/current-user.interface';
import { SupabaseService } from '../supabase/supabase.service';
import { UpdateUserDto } from './dto/update-user.dto';

type PermissionRow = { permission_code: string };
type GroupMembershipRow = { group_id: string };

@Injectable()
export class UsersService {
  constructor(
    private readonly authService: AuthService,
    private readonly supabaseService: SupabaseService,
  ) {}

  async listUsers(_currentUser: CurrentUser) {
    const { data, error } = await this.supabaseService.adminClient
      .from('users')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return {
      users: await Promise.all((data as AppUserProfileRecord[]).map(profile => this.buildUserPayload(profile))),
    };
  }

  async getUser(_currentUser: CurrentUser, userId: string) {
    const profile = await this.getProfileById(userId);
    return { user: await this.buildUserPayload(profile) };
  }

  async createUser(_currentUser: CurrentUser, dto: RegisterDto) {
    const authResponse = await this.authService.register(dto);
    return { user: authResponse.user };
  }

  async updateUser(_currentUser: CurrentUser, userId: string, dto: UpdateUserDto) {
    const currentProfile = await this.getProfileById(userId);

    const nextUsername = dto.usuario?.trim().toLowerCase();
    const nextEmail = dto.email?.trim().toLowerCase();

    if (nextUsername && nextUsername !== currentProfile.username) {
      const { data, error } = await this.supabaseService.adminClient
        .from('users')
        .select('id')
        .eq('username', nextUsername)
        .neq('id', userId)
        .maybeSingle<{ id: string }>();

      if (error) {
        throw new InternalServerErrorException(error.message);
      }

      if (data) {
        throw new ConflictException('Ya existe un usuario con ese nombre de usuario');
      }
    }

    if (nextEmail && nextEmail !== currentProfile.email) {
      const { data, error } = await this.supabaseService.adminClient
        .from('users')
        .select('id')
        .eq('email', nextEmail)
        .neq('id', userId)
        .maybeSingle<{ id: string }>();

      if (error) {
        throw new InternalServerErrorException(error.message);
      }

      if (data) {
        throw new ConflictException('Ya existe un usuario con ese email');
      }
    }

    const updatePayload = {
      username: nextUsername,
      full_name: dto.fullName?.trim(),
      email: nextEmail,
      date_of_birth: dto.dob,
      phone: dto.phone?.trim(),
      address: dto.address?.trim(),
      is_superuser: dto.isSuperuser,
    };

    const { data, error } = await this.supabaseService.adminClient
      .from('users')
      .update(updatePayload)
      .eq('id', userId)
      .select('*')
      .single<AppUserProfileRecord>();

    if (error || !data) {
      throw new NotFoundException('Usuario no encontrado');
    }

    if (nextEmail && nextEmail !== currentProfile.email) {
      const authUserId = await this.findAuthUserIdByEmail(currentProfile.email);
      if (authUserId) {
        const { error: authError } = await this.supabaseService.adminClient.auth.admin.updateUserById(
          authUserId,
          { email: nextEmail },
        );

        if (authError) {
          throw new BadRequestException(authError.message);
        }
      }
    }

    return { user: await this.buildUserPayload(data) };
  }

  async deleteUser(_currentUser: CurrentUser, userId: string) {
    const profile = await this.getProfileById(userId);
    const authUserId = await this.findAuthUserIdByEmail(profile.email);

    const { error: profileDeleteError } = await this.supabaseService.adminClient
      .from('users')
      .delete()
      .eq('id', userId);

    if (profileDeleteError) {
      throw new BadRequestException(profileDeleteError.message);
    }

    if (authUserId) {
      const { error: authError } = await this.supabaseService.adminClient.auth.admin.deleteUser(authUserId);
      if (authError) {
        throw new BadRequestException(authError.message);
      }
    }

    return { success: true };
  }

  private async getProfileById(userId: string) {
    const { data, error } = await this.supabaseService.adminClient
      .from('users')
      .select('*')
      .eq('id', userId)
      .single<AppUserProfileRecord>();

    if (error || !data) {
      throw new NotFoundException('Usuario no encontrado');
    }

    return data;
  }

  private async buildUserPayload(profile: AppUserProfileRecord) {
    const [permissionsResult, groupMembershipsResult] = await Promise.all([
      this.supabaseService.adminClient
        .from('v_user_effective_permissions')
        .select('permission_code')
        .eq('user_id', profile.id),
      this.supabaseService.adminClient
        .from('group_members')
        .select('group_id')
        .eq('user_id', profile.id),
    ]);

    if (permissionsResult.error) {
      throw new InternalServerErrorException(permissionsResult.error.message);
    }

    if (groupMembershipsResult.error) {
      throw new InternalServerErrorException(groupMembershipsResult.error.message);
    }

    const permissions = Array.from(
      new Set((permissionsResult.data as PermissionRow[]).map(item => item.permission_code)),
    ).sort();

    const groupIds = Array.from(
      new Set((groupMembershipsResult.data as GroupMembershipRow[]).map(item => item.group_id)),
    );

    return {
      id: profile.id,
      username: profile.username,
      fullName: profile.full_name,
      email: profile.email,
      dateOfBirth: profile.date_of_birth,
      phone: profile.phone,
      address: profile.address,
      isSuperuser: profile.is_superuser,
      permissions,
      groupIds,
    };
  }

  private async findAuthUserIdByEmail(email: string) {
    const perPage = 200;

    for (let page = 1; page <= 20; page += 1) {
      const { data, error } = await this.supabaseService.adminClient.auth.admin.listUsers({ page, perPage });

      if (error) {
        throw new InternalServerErrorException(error.message);
      }

      const user = data.users.find(item => item.email?.toLowerCase() === email.toLowerCase());
      if (user?.id) {
        return user.id;
      }

      if (data.users.length < perPage) {
        break;
      }
    }

    return null;
  }
}
