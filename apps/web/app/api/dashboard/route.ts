import { authorize } from '../../../lib/auth';
import { db } from '../../../lib/db';
import { dashboard } from '../../../../../packages/core/dashboard.ts';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const auth = await authorize(request);
  if (auth instanceof Response) return auth;
  return Response.json(dashboard(db(), auth.userId), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
