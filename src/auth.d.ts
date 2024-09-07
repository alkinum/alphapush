import type { DefaultSession } from '@auth/core/types';

export type UserRole = 'admin' | 'user';

declare module '@auth/core/types' {
  interface Session {
    user: {
      id: string;
      role: UserRole;
    } & DefaultSession['user'];
  }
}
