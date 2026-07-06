import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 🚀 PATHWAY EXCEPTIONS: Prevent middleware from blocking or redirecting auth/public routes
  const isPublicRoute = 
    pathname.startsWith('/signin') || 
    pathname.startsWith('/signup') || 
    pathname.startsWith('/setup-password') || 
    pathname.startsWith('/api/login') || 
    pathname.startsWith('/api/auth/activate') ||
    pathname.startsWith('/api/auth/sms-send') ||    // 🚀 UNLOCKED: Twilio OTP Dispatch
    pathname.startsWith('/api/auth/sms-verify') ||  // 🚀 UNLOCKED: Twilio OTP Verification
    pathname.startsWith('/api/products/public') ||  // 🚀 UNLOCKED: Public Catalog & Player Fetch
    pathname.startsWith('/api/webhook') ||
    pathname.startsWith('/_next') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.jpg') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.ico');

  if (isPublicRoute) {
    return NextResponse.next();
  }

  // Retrieve user session verification flags (custom-engineered for dashboard.koba-i.com)
  const sessionToken = request.cookies.get('session-token');

  if (!sessionToken) {
    // Redirect unauthenticated dashboard users cleanly to sign-in page
    const loginUrl = new URL('/signin', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};