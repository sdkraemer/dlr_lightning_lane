import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { parkDate } from './time.ts';
import { supportsBooking } from './attractions.ts';
import { parkHours } from './park-hours.ts';

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const targetClock = clock.refine(
  (value) => Number(value.slice(3)) % 5 === 0,
  'Desired times must use five-minute increments.'
);
export const bookingInput = z.object({
  attractionId: z.string().min(1).max(100),
  reservedStart: clock.refine(
    (value) => Number(value.slice(3)) % 5 === 0,
    'Reserved start must use five-minute increments.'
  ),
  targetEarliest: z.union([targetClock, z.literal('')]),
  targetLatest: z.union([targetClock, z.literal('')]),
  earlyMinutes: z.number().int().min(0).max(120).default(15),
});
export function saveBooking(
  db: DatabaseSync,
  userId: number,
  input: unknown,
  id?: number,
  now = Date.now()
) {
  const b = bookingInput.parse(input);
  const date = parkDate(now);
  if (!supportsBooking(db, b.attractionId))
    throw new Error('Choose an attraction with Lightning Lane Multi Pass.');
  const attraction = db.prepare('SELECT park_id FROM attractions WHERE id=?').get(b.attractionId)!;
  const hours = parkHours(db, String(attraction.park_id), now);
  if (!hours.slots.length) throw new Error('Park hours are unavailable. Please try again shortly.');
  const resolveTime = (value: string) => {
    const slot = hours.slots.find(slot => slot.value === value);
    if (!slot) throw new Error('Choose a time during this park’s operating hours.');
    return slot.instant;
  };
  const start = resolveTime(b.reservedStart);
  const end = start + 60 * 60_000;
  if (!!b.targetEarliest !== !!b.targetLatest)
    throw new Error('Enter both target boundaries or leave both empty.');
  const earliest = b.targetEarliest
    ? resolveTime(b.targetEarliest)
    : null;
  const latest = b.targetLatest ? resolveTime(b.targetLatest) : null;
  if (earliest !== null && latest !== null && latest < earliest)
    throw new Error('Target latest must be at or after earliest.');
  db.exec('BEGIN IMMEDIATE');
  try {
    if (id !== undefined) {
      const prior = db
        .prepare('SELECT visit_date FROM bookings WHERE id=? AND user_id=?')
        .get(id, userId);
      if (!prior || prior.visit_date !== date)
        throw new Error('Only today’s bookings can be edited.');
      db.prepare(
        `UPDATE bookings SET attraction_id=?,reserved_start=?,reserved_end=?,
        target_earliest_start=?,target_latest_start=?,early_threshold_minutes=?,
        revision=revision+1,watch_state='waiting',updated_at=? WHERE id=? AND user_id=?`
      ).run(
        b.attractionId,
        start,
        end,
        earliest,
        latest,
        b.earlyMinutes,
        now,
        id,
        userId
      );
      db.prepare(
        `UPDATE push_deliveries SET canceled_at=? WHERE sent_at IS NULL AND canceled_at IS NULL
        AND event_id IN (SELECT id FROM alert_events WHERE booking_id=?)`
      ).run(now, id);
    } else {
      id = Number(
        db
          .prepare(
            `INSERT INTO bookings(attraction_id,visit_date,reserved_start,reserved_end,
        target_earliest_start,target_latest_start,early_threshold_minutes,created_at,updated_at,user_id)
        VALUES(?,?,?,?,?,?,?,?,?,?)`
          )
          .run(
            b.attractionId,
            date,
            start,
            end,
            earliest,
            latest,
            b.earlyMinutes,
            now,
            now,
            userId
          ).lastInsertRowid
      );
    }
    db.exec('COMMIT');
    return id;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
export function setBookingState(
  db: DatabaseSync,
  userId: number,
  id: number,
  state: string,
  now = Date.now()
) {
  if (!['paused', 'completed', 'waiting'].includes(state))
    throw new Error('Invalid booking state.');
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = db
      .prepare(
        'UPDATE bookings SET watch_state=?,revision=revision+1,updated_at=? WHERE id=? AND visit_date=? AND user_id=?'
      )
      .run(state, now, id, parkDate(now), userId);
    if (!result.changes) throw new Error('Booking not found for today.');
    db.prepare(
      `UPDATE push_deliveries SET canceled_at=? WHERE sent_at IS NULL AND canceled_at IS NULL
      AND event_id IN (SELECT id FROM alert_events WHERE booking_id=?)`
    ).run(now, id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
