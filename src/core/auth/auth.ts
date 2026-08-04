import NextAuth from "next-auth";
import { MongoDBAdapter } from "@auth/mongodb-adapter";
import clientPromise from "@/core/db/mongo-client";
import { authConfig } from "./auth.config";

/**
 * Full, Node-runtime NextAuth instance (API routes, server components, server actions) — adds the
 * MongoDB adapter on top of the edge-safe `authConfig`. Never import this from `middleware.ts`;
 * see auth.config.ts for why.
 *
 * App login only — distinct from the pooled generation accounts in modules/accounts
 * (ARCHITECTURE.md §3). `session.user.id` is the app-wide `userId` referenced by every domain
 * model (Project.userId, Job.userId, ...).
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: MongoDBAdapter(clientPromise),
});
