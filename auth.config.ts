import GitHub from '@auth/core/providers/github';
import { defineConfig } from 'auth-astro';

const ADMIN_EMAILS = import.meta.env.ADMIN_EMAILS?.split(',') || [];

export default defineConfig({
  providers: [
    GitHub({
      clientId: import.meta.env.GITHUB_CLIENT_ID,
      clientSecret: import.meta.env.GITHUB_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    async session({ session }) {
      if (session.user) {
        session.user.role = ADMIN_EMAILS.includes(session.user.email as string) ? 'admin' : 'user';
      }
      return session;
    },
  },
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60,
  },
});
