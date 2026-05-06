import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/constants";
import { verifyHs256Jwt } from "@/lib/edge-session-token";
import { env, isPasswordLoginEnabled } from "@/lib/env";

const publicPaths = ["/login"];

function getSecret() {
  return new TextEncoder().encode(env.EIDON_SESSION_SECRET);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!isPasswordLoginEnabled()) {
    if (pathname === "/login" || pathname.startsWith("/login/")) {
      return NextResponse.redirect(new URL("/", request.url));
    }

    return NextResponse.next();
  }

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/api/auth/login") ||
    pathname.startsWith("/logo") ||
    pathname.startsWith("/eidon-banner")
  ) {
    return NextResponse.next();
  }

  const isPublic = publicPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    if (isPublic) {
      return NextResponse.next();
    }

    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    const payload = await verifyHs256Jwt(token, getSecret());
    if (!payload) {
      throw new Error("Invalid session token");
    }
  } catch {
    if (isPublic) {
      return NextResponse.next();
    }

    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete(SESSION_COOKIE_NAME);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/auth/logout).*)"]
};
