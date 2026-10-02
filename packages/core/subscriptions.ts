import type { DatabaseSync } from 'node:sqlite';
import type webpush from 'web-push';

export function activeSubscription(
  db: DatabaseSync,
  userId: number,
  endpoint: string
) {
  const row = db
    .prepare(
      'SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE endpoint=? AND user_id=? AND disabled_at IS NULL'
    )
    .get(endpoint, userId);
  return row
    ? {
        endpoint: String(row.endpoint),
        keys: { p256dh: String(row.p256dh), auth: String(row.auth) },
      }
    : null;
}
export function enableSubscription(
  db: DatabaseSync,
  userId: number,
  sub: webpush.PushSubscription,
  now = Date.now()
) {
  const result = db
    .prepare(
      `INSERT INTO push_subscriptions(endpoint,p256dh,auth,created_at,user_id) VALUES(?,?,?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth,disabled_at=NULL
    WHERE push_subscriptions.user_id=excluded.user_id`
    )
    .run(sub.endpoint, sub.keys.p256dh, sub.keys.auth, now, userId);
  if (!result.changes)
    throw new Error('Create a new device subscription for this account.');
}
export function disableSubscription(
  db: DatabaseSync,
  userId: number,
  endpoint: string,
  now = Date.now()
) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      'UPDATE push_subscriptions SET disabled_at=? WHERE endpoint=? AND user_id=?'
    ).run(now, endpoint, userId);
    db.prepare(
      `UPDATE push_deliveries SET canceled_at=? WHERE sent_at IS NULL AND canceled_at IS NULL
      AND subscription_id IN (SELECT id FROM push_subscriptions WHERE endpoint=? AND user_id=?)`
    ).run(now, endpoint, userId);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
