import type { DatabaseSync } from 'node:sqlite';
import { eligibleWhere } from '../db/index.ts';
import { parkDate } from './time.ts';
export const MAX_OBSERVATION_AGE = 5 * 60_000;
export type Offer = {
  observed_at: number;
  status: string;
  state: string | null;
  return_start: string | null;
  return_end: string | null;
};
export function phaseFor(
  offer: Offer | undefined,
  earliest: number,
  latest: number,
  margin: number,
  now = Date.now()
) {
  if (
    !offer ||
    now - offer.observed_at > MAX_OBSERVATION_AGE ||
    offer.observed_at > now ||
    offer.status !== 'OPERATING' ||
    offer.state !== 'AVAILABLE' ||
    !offer.return_start ||
    !offer.return_end
  )
    return null;
  const start = Date.parse(offer.return_start),
    end = Date.parse(offer.return_end);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end < start ||
    end <= now ||
    parkDate(start) !== parkDate(now)
  )
    return null;
  if (start >= earliest && start <= latest) return 'reached';
  if (start >= earliest - margin * 60_000 && start <= latest + margin * 60_000)
    return 'approaching';
  return null;
}
export function latestOffer(
  db: DatabaseSync,
  attractionId: string,
  type = 'RETURN_TIME'
) {
  return db
    .prepare(
      `SELECT o.id,o.observed_at,o.status,o.standby_wait,o.api_last_updated,
    q.state,q.return_start,q.return_end FROM observations o
    LEFT JOIN queue_observations q ON q.observation_id=o.id AND q.queue_type=?
    WHERE o.attraction_id=? ORDER BY o.observed_at DESC,o.id DESC LIMIT 1`
    )
    .get(type, attractionId) as
    | (Offer & {
        id: number;
        standby_wait: number | null;
        api_last_updated: string | null;
      })
    | undefined;
}
export function evaluateAlerts(db: DatabaseSync, now = Date.now()) {
  if (process.env.MONITORING_ENABLED === 'false') return;
  db.exec('BEGIN IMMEDIATE');
  try {
    const bookings = db
      .prepare('SELECT * FROM bookings WHERE ' + eligibleWhere)
      .all(parkDate(now));
    for (const b of bookings) {
      const offer = latestOffer(
        db,
        String(b.attraction_id),
        String(b.queue_type)
      );
      const phase = phaseFor(
        offer,
        Number(b.target_earliest_start),
        Number(b.target_latest_start),
        Number(b.early_threshold_minutes),
        now
      );
      db.prepare('UPDATE bookings SET watch_state=? WHERE id=?').run(
        phase === 'reached'
          ? 'reached'
          : phase === 'approaching'
            ? 'watch'
            : 'waiting',
        b.id
      );
      if (!phase || !offer) continue;
      // Once reached, do not issue a weaker approaching notification for this revision.
      if (
        phase === 'approaching' &&
        db
          .prepare(
            "SELECT 1 FROM alert_events WHERE booking_id=? AND booking_revision=? AND phase='reached'"
          )
          .get(b.id, b.revision)
      )
        continue;
      const result = db
        .prepare(
          'INSERT OR IGNORE INTO alert_events(booking_id,booking_revision,phase,observation_id,created_at) VALUES(?,?,?,?,?)'
        )
        .run(b.id, b.revision, phase, offer.id, now);
      if (phase === 'reached')
        db.prepare(
          `UPDATE push_deliveries SET canceled_at=? WHERE sent_at IS NULL AND canceled_at IS NULL
        AND event_id IN (SELECT id FROM alert_events WHERE booking_id=? AND booking_revision=? AND phase='approaching')`
        ).run(now, b.id, b.revision);
      if (result.changes)
        db.prepare(
          `INSERT INTO push_deliveries(event_id,subscription_id,next_attempt_at)
        SELECT ?,id,? FROM push_subscriptions WHERE disabled_at IS NULL AND user_id=?`
        ).run(result.lastInsertRowid, now, b.user_id);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
