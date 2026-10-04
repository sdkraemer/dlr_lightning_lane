import { offerHistoryToday, targetProgress } from './offer-history.ts';
import { estimateTarget } from './offer-trend.ts';
import type { DatabaseSync } from 'node:sqlite';
import { eligibleWhere } from '../db/index.ts';
import { parkDate } from './time.ts';
import { latestOffer, MAX_OBSERVATION_AGE } from './alerts.ts';
import { bookingAttractions } from './attractions.ts';
import { parkHours } from './park-hours.ts';
import { PARKS } from '../themeparks/index.ts';
export function dashboard(db: DatabaseSync, userId: number, now = Date.now()) {
  const date = parkDate(now);
  const bookings = db
    .prepare(
      `SELECT b.*,a.name,p.name park_name FROM bookings b JOIN attractions a ON a.id=b.attraction_id
    JOIN parks p ON p.id=a.park_id WHERE b.visit_date=? AND b.user_id=? ORDER BY b.reserved_start`
    )
    .all(date, userId)
    .map((b) => {
      const offer = latestOffer(
        db,
        String(b.attraction_id),
        String(b.queue_type)
      );
      const history = offerHistoryToday(db, String(b.attraction_id), String(b.queue_type), now);
      const progress = history.farthest && b.target_earliest_start !== null
        ? targetProgress(Date.parse(history.farthest.return_start),
            Number(b.target_earliest_start), Number(b.target_latest_start),
            Number(b.early_threshold_minutes))
        : null;
      let displayState = 'Waiting';
      if (b.watch_state === 'completed') displayState = 'Completed';
      else if (b.watch_state === 'paused') displayState = 'Paused';
      else if (b.target_earliest_start === null) displayState = 'No target';
      else if (
        Number(b.reserved_start) >= Number(b.target_earliest_start) &&
        Number(b.reserved_start) <= Number(b.target_latest_start)
      )
        displayState = 'Booking in target';
      else if (progress === 'reached') displayState = 'Target reached';
      else if (progress === 'passed') displayState = 'Target passed';
      else if (!offer || offer.observed_at > now || now - offer.observed_at > MAX_OBSERVATION_AGE)
        displayState = 'Awaiting fresh data';
      else if (progress === 'approaching') displayState = 'Watch';
      const estimate = b.target_earliest_start !== null &&
        b.watch_state !== 'paused' && b.watch_state !== 'completed' &&
        displayState !== 'Booking in target' && process.env.MONITORING_ENABLED !== 'false'
          ? estimateTarget(history, offer, Number(b.target_earliest_start), Number(b.target_latest_start), now)
          : null;
      return { ...b, offer: offer ?? null, farthestOffer: history.farthest, displayState, estimate };
    });
  return {
    date,
    now,
    parkHours: PARKS.map(park => parkHours(db, park.id, now)),
    bookings,
    monitoringEnabled: process.env.MONITORING_ENABLED !== 'false',
    pollingNeeded: Boolean(
      db
        .prepare(
          'SELECT 1 FROM bookings WHERE ' +
            eligibleWhere +
            ' AND user_id=? LIMIT 1'
        )
        .get(date, userId)
    ),
    heartbeat:
      db.prepare('SELECT heartbeat_at FROM worker_state WHERE id=1').get()
        ?.heartbeat_at ?? null,
    parks: db
      .prepare(
        `SELECT p.*,r.fetched_at,r.outcome,r.error FROM parks p LEFT JOIN poll_runs r ON r.id=(
      SELECT id FROM poll_runs WHERE park_id=p.id ORDER BY fetched_at DESC,id DESC LIMIT 1)`
      )
      .all(),
    attractions: bookingAttractions(db),
    deliveries: db
      .prepare(
        `SELECT d.sent_at,d.last_error,d.canceled_at,e.phase,a.name FROM push_deliveries d
      JOIN alert_events e ON e.id=d.event_id JOIN bookings b ON b.id=e.booking_id
      JOIN attractions a ON a.id=b.attraction_id WHERE b.user_id=? ORDER BY e.created_at DESC LIMIT 5`
      )
      .all(userId),
  };
}
