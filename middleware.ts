import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  DASHBOARD_SESSION_COOKIE,
  resolveDashboardSessionSecret,
  verifyDashboardSession,
} from "@/core/security/dashboard-session";

const PUBLIC_PAGE_PREFIXES = ["/signin", "/signup", "/setup-password"];
const PUBLIC_READER_PAGES = new Set([
  "/reader",
  "/reader/signin",
  "/reader/signup",
  "/reader/recover",
  "/reader/claim",
  "/reader/account",
  "/reader/open",
  "/reader/free",
  "/reader/purchases/recover",
]);
const PUBLIC_API_EXACT_PATHS = new Set([
  "/api/login",
  "/api/logout",
  "/api/session",
  "/api/auth/activate",
  "/api/auth/invitation",
  "/api/auth/sms-send",
  "/api/auth/sms-verify",
  "/api/products/public",
  "/api/content/public",
  "/api/checkout",
  "/api/checkout/plugin",
  "/api/checkout/listener-session",
  "/api/checkout/listener-session/complete",
  "/api/media/manifest",
  "/api/verify-entitlement",
  "/api/verify-license",
  "/api/library-manifest",
  "/api/reader/session",
  "/api/reader/logout",
  "/api/reader/media/token",
  "/api/reader/media/handoff",
  "/api/reader/media/handoff/exchange",
  "/api/reader/media/free-handoff",
  "/api/reader/purchases/claim",
  "/api/reader/purchases/recover",
]);
const PUBLIC_API_PREFIXES = ["/api/webhook"];
const MVP_PAGE_PREFIXES = [
  "/products",
  "/nexus-engine",
  "/visibility-cure",
  "/connect",
  "/billing",
  "/studio",
  "/workbench",
];
const MVP_API_EXACT_PATHS = new Set([
  "/api/generate-blog",
  "/api/checkout/create-session",
  "/api/agent/deploy",
  "/api/connections/verify",
  "/api/author-identities",
  "/api/stripe/connect/sync",
  "/api/stripe/connect/onboard",
  "/api/stripe/connect/dashboard",
  "/api/nexus/context",
  "/api/nexus/story-worlds",
  "/api/nexus/reference-guides",
  "/api/studio/publications",
  "/api/studio/transcribe",
  "/api/studio/vault",
]);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isStaticAsset(pathname) || isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(DASHBOARD_SESSION_COOKIE)?.value;

  if (!token) {
    return rejectUnauthenticated(request);
  }

  try {
    const session = await verifyDashboardSession(
      token,
      resolveDashboardSessionSecret()
    );

    if (session.accessScope === "full") {
      return NextResponse.next();
    }

    if (pathname.startsWith("/api/")) {
      return MVP_API_EXACT_PATHS.has(pathname)
        ? NextResponse.next()
        : NextResponse.json(
            { success: false, error: "This feature is not available for your account." },
            { status: 404 }
          );
    }

    if (pathname === "/") {
      return NextResponse.next();
    }

    if (MVP_PAGE_PREFIXES.some((prefix) => pathMatchesPrefix(pathname, prefix))) {
      return NextResponse.next();
    }

    return NextResponse.redirect(new URL("/products", request.url));
  } catch {
    const response = rejectUnauthenticated(request);
    response.cookies.set(DASHBOARD_SESSION_COOKIE, "", {
      path: "/",
      maxAge: 0,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
    });
    return response;
  }
}

function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_READER_PAGES.has(pathname)) {
    return true;
  }
  if (PUBLIC_PAGE_PREFIXES.some((prefix) => pathMatchesPrefix(pathname, prefix))) {
    return true;
  }

  if (PUBLIC_API_EXACT_PATHS.has(pathname)) {
    return true;
  }

  return PUBLIC_API_PREFIXES.some((prefix) => pathMatchesPrefix(pathname, prefix));
}

function isStaticAsset(pathname: string): boolean {
  return (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/assets/") ||
    /\.(?:css|js|map|png|jpe?g|gif|svg|ico|webp|woff2?)$/i.test(pathname)
  );
}

function pathMatchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function rejectUnauthenticated(request: NextRequest): NextResponse {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { success: false, error: "Authentication is required." },
      { status: 401 }
    );
  }

  return NextResponse.redirect(new URL("/signin", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
