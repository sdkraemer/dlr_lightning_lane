import webpush from 'web-push';
import type { DatabaseSync } from 'node:sqlite';
import { eligibleWhere } from '../db/index.ts';
import { parkDate } from './time.ts';
import { latestOffer, phaseFor } from './alerts.ts';
export function pushReady() {
  return !!(
    process.env.VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY &&
    process.env.VAPID_SUBJECT
  );
}
export function validPushEndpoint(endpoint: string) {
  try {
    const u = new URL(endpoint);
    return (
      u.protocol === 'https:' &&
      !u.port &&
      !u.username &&
      !u.password &&
      (u.hostname === 'fcm.googleapis.com' ||
        u.hostname === 'updates.push.services.mozilla.com' ||
        u.hostname === 'web.push.apple.com' ||
        u.hostname.endsWith('.notify.windows.com'))
    );
  } catch {
    return false;
  }
}
export async function sendPush(
  subscription: webpush.PushSubscription,
  payload: object
) {
  if (!pushReady()) throw new Error('Configure VAPID keys and subject first.');
  if (!validPushEndpoint(subscription.endpoint))
    throw new Error('Unsupported push service.');
  return webpush.sendNotification(subscription, JSON.stringify(payload), {
    vapidDetails: {
      subject: process.env.VAPID_SUBJECT!,
      publicKey: process.env.VAPID_PUBLIC_KEY!,
      privateKey: process.env.VAPID_PRIVATE_KEY!,
    },
    TTL: 120,
    timeout: 10_000,
  });
}
export async function deliverAlerts(
  db: DatabaseSync,
  now = Date.now(),
  sender = sendPush
) {
  if (!pushReady() || process.env.MONITORING_ENABLED === 'false') return;
  const jobs = db
    .prepare(
      `SELECT d.*,e.booking_id,e.booking_revision,e.phase,s.endpoint,s.p256dh,s.auth,s.disabled_at,s.user_id subscription_user_id
    FROM push_deliveries d JOIN alert_events e ON e.id=d.event_id
    JOIN push_subscriptions s ON s.id=d.subscription_id
    WHERE d.sent_at IS NULL AND d.canceled_at IS NULL AND d.next_attempt_at<=?
    ORDER BY d.next_attempt_at LIMIT 20`
    )
    .all(now);
  for (const j of jobs) {
    const current = Date.now();
    const b = db
      .prepare('SELECT * FROM bookings WHERE id=? AND ' + eligibleWhere)
      .get(j.booking_id, parkDate(current));
    const offer = b
      ? latestOffer(db, String(b.attraction_id), String(b.queue_type))
      : undefined;
    const phase = b
      ? phaseFor(
          offer,
          Number(b.target_earliest_start),
          Number(b.target_latest_start),
          Number(b.early_threshold_minutes),
          current
        )
      : null;
    if (
      !b ||
      b.user_id !== j.subscription_user_id ||
      b.revision !== j.booking_revision ||
      j.disabled_at !== null ||
      phase !== j.phase ||
      Number(j.attempts) >= 5
    ) {
      db.prepare(
        'UPDATE push_deliveries SET canceled_at=? WHERE event_id=? AND subscription_id=?'
      ).run(current, j.event_id, j.subscription_id);
      continue;
    }
    try {
      const attraction = db
        .prepare('SELECT name FROM attractions WHERE id=?')
        .get(b.attraction_id);
      const time = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: 'numeric',
        minute: '2-digit',
      }).format(Date.parse(offer!.return_start!));
      await sender(
        {
          endpoint: String(j.endpoint),
          keys: { p256dh: String(j.p256dh), auth: String(j.auth) },
        },
        {
          title:
            j.phase === 'reached'
              ? 'Your target window is available'
              : 'Your target window is close',
          body:
            String(attraction?.name) +
            ': offered start ' +
            time +
            ' Pacific. Check Disneyland to modify.',
          tag:
            'booking-' +
            String(b.id) +
            '-' +
            String(b.revision) +
            '-' +
            String(j.phase),
          url: '/',
        }
      );
      db.prepare(
        'UPDATE push_deliveries SET sent_at=?,attempts=attempts+1 WHERE event_id=? AND subscription_id=?'
      ).run(Date.now(), j.event_id, j.subscription_id);
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410)
        db.prepare(
          'UPDATE push_subscriptions SET disabled_at=? WHERE id=?'
        ).run(Date.now(), j.subscription_id);
      db.prepare(
        `UPDATE push_deliveries SET attempts=attempts+1,last_error=?,next_attempt_at=?,
        canceled_at=? WHERE event_id=? AND subscription_id=?`
      ).run(
        code ? 'Push service HTTP ' + code : 'Push delivery failed',
        Date.now() + Math.min(900_000, 30_000 * 2 ** Number(j.attempts)),
        code === 404 || code === 410 || Number(j.attempts) >= 4
          ? Date.now()
          : null,
        j.event_id,
        j.subscription_id
      );
    }
  }
}
