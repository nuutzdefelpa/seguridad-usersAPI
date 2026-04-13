import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  readonly publicClient: SupabaseClient;
  readonly adminClient: SupabaseClient;

  constructor(private readonly configService: ConfigService) {
    const supabaseUrl = this.getRequired('SUPABASE_URL');
    const supabaseAnonKey = this.getRequired('SUPABASE_ANON_KEY');
    const supabaseServiceRoleKey =
      this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY') ??
      this.getRequired('SUPABASE_SECRET_KEY');

    const options = {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    };

    this.publicClient = createClient(supabaseUrl, supabaseAnonKey, options);
    this.adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, options);
  }

  private getRequired(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value) {
      throw new Error(`Missing required environment variable: ${key}`);
    }

    return value;
  }
}