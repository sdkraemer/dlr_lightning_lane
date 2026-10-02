import { NextResponse } from 'next/server';
import { auth0, authConfigured, mockAuth } from './lib/auth';
export async function proxy(request: Request) {
  if (mockAuth()) return NextResponse.next();
  if (!authConfigured()) return NextResponse.next();
  return auth0().middleware(request);
}
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|sw.js).*)',
  ],
};
