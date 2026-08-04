import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

/**
 * Edge-runtime-safe subset of the NextAuth config — no database adapter, since `mongodb`'s native
 * driver uses Node APIs (process.hrtime, sockets, ...) that don't exist in Vercel's Edge runtime,
 * which is what `middleware.ts` runs on. This is imported by both `middleware.ts` (directly) and
 * `auth.ts` (spread into the full Node-runtime config that adds the MongoDB adapter).
 */
export const authConfig: NextAuthConfig = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: { access_type: "offline", prompt: "consent" },
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  session: { strategy: "jwt" },
  callbacks: {
    jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
};
