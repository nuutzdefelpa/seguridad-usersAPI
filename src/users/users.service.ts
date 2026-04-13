import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { AuthService } from '../auth/auth.service';
import type { AppUserProfileRecord, CurrentUser } from '../common/interfaces/current-user.interface';
import { SupabaseService } from '../supabase/supabase.service';
import { UpdateUserDto } from './dto/update-user.dto';

type PermissionRow = { permission_code: string };
type GroupMembershipRow = { group_id: string };
type PermissionCatalogRow = { id: string; code: string };

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
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return {
      users: await Promise.all((data as AppUserProfileRecord[]).map(profile => this.buildUserPayload(profile))),
    };
  }

  async getUser(_currentUser: CurrentUser, userId: string) {
    const canViewAllUsers = await this.hasPermission(_currentUser.profile.id, 'users:view');
    const canViewOwnUser = await this.hasPermission(_currentUser.profile.id, 'user:view');
    const isOwnUser = _currentUser.profile.id === userId;

    if (!canViewAllUsers && !(canViewOwnUser && isOwnUser)) {
      throw new ForbiddenException('No tienes permiso para ver este usuario');
    }

    const profile = await this.getProfileById(userId);
    return { user: await this.buildUserPayload(profile) };
  }

  async createUser(_currentUser: CurrentUser, dto: CreateUserDto) {
    const authResponse = await this.authService.register(dto);
    if (dto.permissions) {
      await this.syncGlobalPermissions(authResponse.user.id, dto.permissions);
    }

    const user = await this.getProfileById(authResponse.user.id);
    return { user: await this.buildUserPayload(user) };
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
        .is('deleted_at', null)
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
        .is('deleted_at', null)
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

    if (dto.permissions) {
      await this.syncGlobalPermissions(userId, dto.permissions);
    }

    const refreshedUser = await this.getProfileById(userId);
    return { user: await this.buildUserPayload(refreshedUser) };
  }

  async deleteUser(_currentUser: CurrentUser, userId: string) {
    const profile = await this.getProfileById(userId);
    const authUserId = await this.findAuthUserIdByEmail(profile.email);

    const tombstoneUsername = `deleted_${userId}`;
    const tombstoneEmail = `deleted_${userId}@deleted.local`;

    const cleanupTargets = [
      this.supabaseService.adminClient.from('group_members').delete().eq('user_id', userId),
      this.supabaseService.adminClient.from('user_permissions').delete().eq('user_id', userId),
      this.supabaseService.adminClient.from('user_group_permissions').delete().eq('user_id', userId),
      this.supabaseService.adminClient.from('temporary_permissions').delete().eq('user_id', userId),
      this.supabaseService.adminClient.from('tickets').update({ assignee_id: null }).eq('assignee_id', userId),
    ];

    const cleanupResults = await Promise.all(cleanupTargets);
    for (const result of cleanupResults) {
      if (result.error) {
        throw new BadRequestException(result.error.message);
      }
    }

    const { error: profileDeleteError } = await this.supabaseService.adminClient
      .from('users')
      .update({
        username: tombstoneUsername,
        full_name: 'Usuario eliminado',
        email: tombstoneEmail,
        phone: null,
        address: null,
        is_superuser: false,
        deleted_at: new Date().toISOString(),
      })
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
      .is('deleted_at', null)
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
    ).sort((left, right) => left.localeCompare(right));

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

  private async hasPermission(userId: string, permissionCode: string) {
    const { data, error } = await this.supabaseService.adminClient.rpc('user_has_permission', {
      p_user_id: userId,
      p_permission_code: permissionCode,
      p_group_id: null,
    });

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return Boolean(data);
  }

  private async syncGlobalPermissions(userId: string, permissionCodes: string[]) {
    const nextCodes = Array.from(new Set(permissionCodes.map(code => code.trim()).filter(Boolean)));

    const { data: permissionCatalog, error: permissionCatalogError } = await this.supabaseService.adminClient
      .from('permissions')
      .select('id, code')
      .in('code', nextCodes.length > 0 ? nextCodes : ['__never__']);

    if (permissionCatalogError) {
      throw new InternalServerErrorException(permissionCatalogError.message);
    }

    const foundCodes = new Set((permissionCatalog as PermissionCatalogRow[]).map(item => item.code));
    const missingCodes = nextCodes.filter(code => !foundCodes.has(code));
    if (missingCodes.length > 0) {
      throw new BadRequestException(`Permisos inválidos: ${missingCodes.join(', ')}`);
    }

    const { error: deleteError } = await this.supabaseService.adminClient
      .from('user_permissions')
      .delete()
      .eq('user_id', userId);

    if (deleteError) {
      throw new InternalServerErrorException(deleteError.message);
    }

    const rowsToInsert = (permissionCatalog as PermissionCatalogRow[]).map(permission => ({
      user_id: userId,
      permission_id: permission.id,
    }));

    if (rowsToInsert.length === 0) {
      return;
    }

    const { error: insertError } = await this.supabaseService.adminClient
      .from('user_permissions')
      .insert(rowsToInsert);

    if (insertError) {
      throw new InternalServerErrorException(insertError.message);
    }
  }
}
