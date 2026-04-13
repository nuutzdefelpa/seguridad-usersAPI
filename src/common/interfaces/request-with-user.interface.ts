import { Request } from 'express';
import { CurrentUser } from './current-user.interface';

export interface RequestWithUser extends Request {
  user: CurrentUser;
}