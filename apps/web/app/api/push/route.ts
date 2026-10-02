import {z} from 'zod';
import {authorize} from '../../../lib/auth';
import {db} from '../../../lib/db';
import {pushReady,sendPush,validPushEndpoint} from '../../../../../packages/core/push.ts';
const schema=z.object({endpoint:z.string().max(4096).refine(validPushEndpoint,'Unsupported push service.'),
  keys:z.object({p256dh:z.string().regex(/^[A-Za-z0-9_-]+$/).min(80).max(120),auth:z.string().regex(/^[A-Za-z0-9_-]+$/).min(20).max(30)})});
export async function GET(request:Request) {
  const denied=await authorize(request);if(denied)return denied;
  return Response.json({configured:pushReady(),publicKey:pushReady()?process.env.VAPID_PUBLIC_KEY:null},{headers:{'Cache-Control':'no-store'}});
}
export async function POST(request:Request) {
  const denied=await authorize(request,true);if(denied)return denied;
  try {
    const body=await request.json();
    const sub=schema.parse(body.subscription);
    if(body.action==='disable') {
      db().prepare('UPDATE push_subscriptions SET disabled_at=? WHERE endpoint=?').run(Date.now(),sub.endpoint);
      return Response.json({ok:true});
    }
    if(!pushReady())return Response.json({error:'VAPID is not configured.'},{status:503});
    if(body.action==='test') {
      if(!db().prepare('SELECT 1 FROM push_subscriptions WHERE endpoint=? AND disabled_at IS NULL').get(sub.endpoint))
        throw new Error('Enable notifications on this device first.');
      await sendPush(sub,{title:'Lightning Lane test',body:'This device is ready for alerts.',tag:'test',url:'/'});
    } else {
      db().prepare(`INSERT INTO push_subscriptions(endpoint,p256dh,auth,created_at) VALUES(?,?,?,?)
        ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth,disabled_at=NULL`)
        .run(sub.endpoint,sub.keys.p256dh,sub.keys.auth,Date.now());
    }
    return Response.json({ok:true});
  } catch {return Response.json({error:'Could not update or test this push subscription. Check configuration and try again.'},{status:400});}
}
