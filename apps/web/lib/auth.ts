import { Auth0Client } from '@auth0/nextjs-auth0/server';
import { ensureUser } from '../../../packages/db/index.ts';
import { db } from './db';
export function mockAuth() {
  if (process.env.DEV_MOCK_AUTH !== 'true') return false;
  if (process.env.NODE_ENV !== 'development')
    throw new Error('Mock authentication is forbidden outside development.');
  return true;
}
export function authConfigured() {
  return [
    'AUTH0_DOMAIN',
    'AUTH0_CLIENT_ID',
    'AUTH0_CLIENT_SECRET',
    'AUTH0_SECRET',
    'APP_BASE_URL',
  ].every((k) => !!process.env[k] && !process.env[k]!.includes('replace-me'));
}
let client: Auth0Client | undefined;
export function auth0() {
  if (!authConfigured()) throw new Error('Auth0 is not configured.');
  return (client ??= new Auth0Client({
    appBaseUrl: process.env.APP_BASE_URL,
    enableAccessTokenEndpoint: false,
  }));
}
export async function currentUserId(): Promise<number | null> {
  if (mockAuth()) return ensureUser(db(), 'local-preview');
  if (!authConfigured()) return null;
  const session = await auth0().getSession();
  return session?.user.sub ? ensureUser(db(), session.user.sub) : null;
}
export async function sessionStatus(): Promise<
  'authenticated' | 'anonymous' | 'unconfigured'
> {
  if (mockAuth()) return 'authenticated';
  if (!authConfigured()) return 'unconfigured';
  const session = await auth0().getSession();
  if (!session) return 'anonymous';
  return session.user.sub ? 'authenticated' : 'anonymous';
}
export async function authorize(request: Request, write = false) {
  if (!mockAuth() && !authConfigured())
    return Response.json(
      { error: 'Auth0 is not configured.' },
      { status: 503 }
    );
  const userId = await currentUserId();
  if (userId === null)
    return Response.json({ error: 'Sign in to continue.' }, { status: 401 });
  if (write) {
    const base = process.env.APP_BASE_URL ?? 'http://localhost:3000';
    if (request.headers.get('origin') !== new URL(base).origin)
      return Response.json({ error: 'Origin rejected.' }, { status: 403 });
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      return Response.json({ error: 'JSON body required.' }, { status: 415 });
  }
  return { userId };
}
