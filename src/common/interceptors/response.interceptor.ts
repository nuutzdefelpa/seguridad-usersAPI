import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { INT_OP_CODE_KEY } from '../decorators/operation-code.decorator';

export interface StandardResponse<T = unknown> {
  statusCode: number;
  intOpCode: string;
  data: T | null;
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, StandardResponse<T | null>> {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<StandardResponse<T | null>> {
    const intOpCode =
      this.reflector.getAllAndOverride<string>(INT_OP_CODE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'OK';

    const httpResponse = context.switchToHttp().getResponse<{ statusCode: number }>();

    return next.handle().pipe(
      map(data => ({
        statusCode: httpResponse.statusCode,
        intOpCode,
        data: data ?? null,
      })),
    );
  }
}
