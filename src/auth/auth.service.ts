import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Session } from '@supabase/supabase-js';
import { AppUserProfileRecord, CurrentUser } from '../common/interfaces/current-user.interface';
import { SupabaseService } from '../supabase/supabase.service';
import { DEFAULT_PERMISSION_CODES } from './auth.constants';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

type PermissionRow = { permission_code: string };
type GroupMembershipRow = { group_id: string };
type PermissionIdRow = { id: string; code: string };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async register(dto: RegisterDto) {
    this.assertAdult(dto.dob);

    const username = dto.usuario.trim().toLowerCase();
    const email = dto.email.trim().toLowerCase();
    const fullName = dto.fullName.trim();

    await this.ensureProfileDoesNotExist(username, email);

    let authUserId: string | null = null;
    let profileId: string | null = null;

    try {
      const { data: authData, error: authError } =
        await this.supabaseService.adminClient.auth.admin.createUser({
          email,
          password: dto.password,
          email_confirm: true,
          user_metadata: {
            username,
            full_name: fullName,
          },
        });

      if (authError) {
        throw new ConflictException(authError.message);
      }

      authUserId = authData.user?.id ?? null;
      if (!authUserId) {
        throw new InternalServerErrorException('Supabase did not return an auth user id');
      }

      const { data: profile, error: profileError } = await this.supabaseService.adminClient
        .from('users')
        .insert({
          username,
          full_name: fullName,
          email,
          date_of_birth: dto.dob,
          phone: dto.phone.trim(),
          address: dto.address.trim(),
          is_superuser: false,
        })
        .select('*')
        .single<AppUserProfileRecord>();

      if (profileError) {
        await this.safeDeleteAuthUser(authUserId);
        throw new ConflictException(profileError.message);
      }

      profileId = profile.id;
      await this.assignDefaultPermissions(profile.id);

      return this.login({ email, password: dto.password });
    } catch (error) {
      if (profileId) {
        await this.safeDeleteProfile(profileId);
      }
      if (authUserId) {
        await this.safeDeleteAuthUser(authUserId);
      }
      throw error;
    }
  }

  async login(dto: LoginDto) {
    const identifier = dto.email.trim().toLowerCase();
    const email = await this.resolveLoginEmail(identifier);

    const { data, error } = await this.supabaseService.publicClient.auth.signInWithPassword({
      email,
      password: dto.password,
    });

    if (error || !data.user || !data.session) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const profile = await this.getProfileByEmail(email);
    return this.buildAuthResponse(data.session, profile);
  }

  async getCurrentUserFromAccessToken(accessToken: string): Promise<CurrentUser> {
    const { data, error } = await this.supabaseService.publicClient.auth.getUser(accessToken);

    if (error || !data.user?.email) {
      throw new UnauthorizedException('Token inválido o expirado');
    }

    const email = data.user.email.toLowerCase();
    const profile = await this.getProfileByEmail(email);

    return {
      authUserId: data.user.id,
      email,
      profile,
    };
  }

  async getMe(currentUser: CurrentUser) {
    return {
      user: await this.buildUserPayload(currentUser.profile),
    };
  }

  private async buildAuthResponse(session: Session | null, profile: AppUserProfileRecord) {
    return {
      session: this.mapSession(session),
      user: await this.buildUserPayload(profile),
    };
  }

  private mapSession(session: Session | null) {
    if (!session) {
      throw new UnauthorizedException('No session returned by Supabase');
    }

    return {
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      expiresAt: session.expires_at ?? null,
      tokenType: session.token_type,
    };
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

  private async resolveLoginEmail(identifier: string) {
    if (identifier.includes('@')) {
      return identifier;
    }

    const { data, error } = await this.supabaseService.adminClient
      .from('users')
      .select('email')
      .eq('username', identifier)
      .maybeSingle<{ email: string }>();

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    if (!data?.email) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    return data.email.toLowerCase();
  }

  private async getProfileByEmail(email: string) {
    const { data, error } = await this.supabaseService.adminClient
      .from('users')
      .select('*')
      .eq('email', email)
      .single<AppUserProfileRecord>();

    if (error || !data) {
      throw new UnauthorizedException('No existe un perfil asociado a este usuario');
    }

    return data;
  }

  private async ensureProfileDoesNotExist(username: string, email: string) {
    const [emailResult, usernameResult] = await Promise.all([
      this.supabaseService.adminClient
        .from('users')
        .select('id')
        .eq('email', email)
        .maybeSingle<{ id: string }>(),
      this.supabaseService.adminClient
        .from('users')
        .select('id')
        .eq('username', username)
        .maybeSingle<{ id: string }>(),
    ]);

    if (emailResult.error) {
      throw new InternalServerErrorException(emailResult.error.message);
    }

    if (usernameResult.error) {
      throw new InternalServerErrorException(usernameResult.error.message);
    }

    if (emailResult.data) {
      throw new ConflictException('Ya existe un usuario con ese email');
    }

    if (usernameResult.data) {
      throw new ConflictException('Ya existe un usuario con ese nombre de usuario');
    }
  }

  private async assignDefaultPermissions(userId: string) {
    const { data: permissionRows, error: permissionsError } = await this.supabaseService.adminClient
      .from('permissions')
      .select('id, code')
      .in('code', [...DEFAULT_PERMISSION_CODES]);

    if (permissionsError) {
      throw new InternalServerErrorException(permissionsError.message);
    }

    const foundCodes = new Set((permissionRows as PermissionIdRow[]).map(item => item.code));
    const missingCodes = DEFAULT_PERMISSION_CODES.filter(code => !foundCodes.has(code));
    if (missingCodes.length > 0) {
      throw new InternalServerErrorException(
        `Missing permissions in database: ${missingCodes.join(', ')}`,
      );
    }

    const { error: insertError } = await this.supabaseService.adminClient.from('user_permissions').insert(
      (permissionRows as PermissionIdRow[]).map(item => ({
        user_id: userId,
        permission_id: item.id,
      })),
    );

    if (insertError) {
      throw new InternalServerErrorException(insertError.message);
    }
  }

  private assertAdult(dateOfBirth: string) {
    const dob = new Date(dateOfBirth);
    if (Number.isNaN(dob.getTime())) {
      throw new BadRequestException('Fecha de nacimiento inválida');
    }

    const age = Math.floor((Date.now() - dob.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
    if (age < 18) {
      throw new BadRequestException('Debes ser mayor de edad para registrarte');
    }
  }

  private async safeDeleteAuthUser(authUserId: string) {
    const { error } = await this.supabaseService.adminClient.auth.admin.deleteUser(authUserId);
    if (error) {
      this.logger.warn(`Could not rollback auth user ${authUserId}: ${error.message}`);
    }
  }

  private async safeDeleteProfile(profileId: string) {
    const { error } = await this.supabaseService.adminClient
      .from('users')
      .delete()
      .eq('id', profileId);

    if (error) {
      this.logger.warn(`Could not rollback profile ${profileId}: ${error.message}`);
    }
  }
}