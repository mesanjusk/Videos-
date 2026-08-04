import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/core/auth/auth.config";

// Deliberately built from the edge-safe `authConfig`, not the full `@/core/auth/auth` (which pulls
// in the MongoDB adapter / native driver — incompatible with the Edge runtime middleware runs on).
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const isDashboardRoute =
    req.nextUrl.pathname.startsWith("/dashboard") ||
    req.nextUrl.pathname.startsWith("/projects") ||
    req.nextUrl.pathname.startsWith("/accounts") ||
    req.nextUrl.pathname.startsWith("/settings");

  if (isDashboardRoute && !isLoggedIn) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/dashboard/:path*", "/projects/:path*", "/accounts/:path*", "/settings/:path*"],
};
