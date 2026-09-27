import { randomBytes } from 'node:crypto';

export const newId = (prefix: string): string => `${prefix}_${randomBytes(6).toString('hex')}`;
