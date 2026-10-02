import {authorize} from '../../../lib/auth';
import {db} from '../../../lib/db';
import {dashboard} from '../../../../../packages/core/dashboard.ts';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
  const denied=await authorize(request); if(denied)return denied;
  return Response.json(dashboard(db()),{headers:{'Cache-Control':'no-store'}});
}
