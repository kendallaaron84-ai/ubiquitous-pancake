import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl; //[cite: 7]

  // 🚀 PATHWAY EXCEPTIONS: Prevent middleware from blocking or redirecting auth/public routes
  const isPublicRoute = 
    pathname.startsWith('/signin') || //[cite: 7]
    pathname.startsWith('/signup') || //[cite: 7]
    pathname.startsWith('/setup-password') || //[cite: 7]
    pathname.startsWith('/api/login') || //[cite: 7]
    pathname.startsWith('/api/auth/activate') || //[cite: 7]
    pathname.startsWith('/api/auth/sms-send') ||    // 🚀 UNLOCKED: Twilio OTP Dispatch[cite: 7]
    pathname.startsWith('/api/auth/sms-verify') ||  // 🚀 UNLOCKED: Twilio OTP Verification[cite: 7]
    pathname.startsWith('/api/products/public') ||  // 🚀 UNLOCKED: Public Catalog & Player Fetch[cite: 7]
    pathname.startsWith('/api/verify-entitlement') || // 🎯 UNLOCKED: External WordPress Player Handshakes[cite: 7]
    pathname.startsWith('/api/webhook') || //[cite: 7]
    pathname.startsWith('/_next') || //[cite: 7]
    pathname.endsWith('.png') || //[cite: 7]
    pathname.endsWith('.jpg') || //[cite: 7]
    pathname.endsWith('.svg') || //[cite: 7]
    pathname.endsWith('.ico'); //[cite: 7]

  if (isPublicRoute) {
    return NextResponse.next(); //[cite: 7]
  }

  const sessionToken = request.cookies.get('session-token'); //[cite: 7]

  if (!sessionToken) { //[cite: 7]
    const loginUrl = new URL('/signin', request.url); //[cite: 7]
    return NextResponse.redirect(loginUrl); //[cite: 7]
  }

  return NextResponse.next(); //[cite: 7]
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/products/public|api/auth/sms-send|api/auth/sms-verify|api/verify-entitlement|api/checkout).*)', //[cite: 7]
  ],
};