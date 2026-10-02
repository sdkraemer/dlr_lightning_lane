import { Auth0Client } from '@auth0/nextjs-auth0/server';
export function mockAuth() {
  if (process.env.DEV_MOCK_AUTH !== 'true') return false;
  if (process.env.NODE_ENV !== 'development') throw new Error('Mock authentication is forbidden outside development.');
  return true;
}
export function authConfigured() {
  return ['AUTH0_DOMAIN','AUTH0_CLIENT_ID','AUTH0_CLIENT_SECRET','AUTH0_SECRET','AUTH0_ALLOWED_SUB','APP_BASE_URL']
    .every(k => !!process.env[k] && !process.env[k]!.includes('replace-me'));
}
let client: Auth0Client | undefined;
export function auth0() {
  if (!authConfigured()) throw new Error('Auth0 is not configured.');
  return client ??= new Auth0Client({appBaseUrl:process.env.APP_BASE_URL,enableAccessTokenEndpoint:false});
}
export async function ownerStatus(): Promise<'owner'|'anonymous'|'forbidden'|'unconfigured'> {
  if (mockAuth()) return 'owner';
  if (!authConfigured()) return 'unconfigured';
  const session=await auth0().getSession();
  if (!session) return 'anonymous';
  return session.user.sub === process.env.AUTH0_ALLOWED_SUB ? 'owner' : 'forbidden';
}
export async function authorize(request: Request, write=false) {
  const status=await ownerStatus();
  if (status !== 'owner') return Response.json({error: status === 'unconfigured' ? 'Auth0 is not configured.' : 'Sign in with the authorized account.'},{status:status==='forbidden'?403:status==='unconfigured'?503:401});
  if (write) {
    const base=process.env.APP_BASE_URL ?? 'http://localhost:3000';
    if (request.headers.get('origin') !== new URL(base).origin)
      return Response.json({error:'Origin rejected.'},{status:403});
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      return Response.json({error:'JSON body required.'},{status:415});
  }
  return null;
}
