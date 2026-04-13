import { SetMetadata } from '@nestjs/common';

export const INT_OP_CODE_KEY = 'intOpCode';
export const IntOpCode = (code: string) => SetMetadata(INT_OP_CODE_KEY, code);
