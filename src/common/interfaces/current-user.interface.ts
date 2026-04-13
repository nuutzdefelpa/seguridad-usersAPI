export interface AppUserProfileRecord {
  id: string;
  username: string;
  full_name: string;
  email: string;
  date_of_birth: string | null;
  phone: string | null;
  address: string | null;
  is_superuser: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CurrentUser {
  authUserId: string;
  email: string;
  profile: AppUserProfileRecord;
}