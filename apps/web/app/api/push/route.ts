import { vapidConfiguration } from '../../../../../packages/core/vapid.ts';
import { z } from 'zod';
import { authorize } from '../../../lib/auth';
import { db } from '../../../lib/db';
import {
  pushReady,
  sendPush,
  validPushEndpoint,
} from '../../../../../packages/core/push.ts';
import {
  activeSubscription,
  enableSubscription,
  disableSubscription,
} from '../../../../../packages/core/subscriptions.ts';
const schema = z.object({
  endpoint: z
    .string()
    .max(4096)
    .refine(validPushEndpoint, 'Unsupported push service.'),
  keys: z.object({
    p256dh: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .min(80)
      .max(120),
    auth: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .min(20)
      .max(30),
  }),
});
export async function GET(request: Request) {
  const config = vapidConfiguration();
  const auth = await authorize(request);
  if (auth instanceof Response) return auth;
  return Response.json(
    {
      configured: config.configured,
      publicKey: config.publicKey,
      error: config.error,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
export async function POST(request: Request) {
  const auth = await authorize(request, true);
  if (auth instanceof Response) return auth;
  try {
    if (Number(request.headers.get('content-length') ?? 0) > 10_000)
      return Response.json({ error: 'Request too large.' }, { status: 413 });
    const body = await request.json();
    const sub = schema.parse(body.subscription);
    if (body.action === 'status')
      return Response.json(
        { enabled: !!activeSubscription(db(), auth.userId, sub.endpoint) },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    if (body.action === 'disable') {
      disableSubscription(db(), auth.userId, sub.endpoint);
      return Response.json({ ok: true });
    }
    if (!pushReady())
      return Response.json(
        { error: vapidConfiguration().error },
        { status: 503 }
      );
    if (body.action === 'test') {
      const registered = activeSubscription(db(), auth.userId, sub.endpoint);
      if (!registered)
        throw new Error('Enable notifications on this device first.');
      await sendPush(registered, {
        title: 'Lightning Lane test',
        body: 'This device is ready for alerts.',
        tag: 'test',
        url: '/',
      });
    } else if (body.action === 'enable')
      enableSubscription(db(), auth.userId, sub);
    else throw new Error('Unknown action.');
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      {
        error:
          'Could not update or test this push subscription. Check configuration and try again.',
      },
      { status: 400 }
    );
  }
}
