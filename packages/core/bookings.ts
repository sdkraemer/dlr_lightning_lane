import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { parkDate, localInstant, nextDate } from './time.ts';

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const bookingInput = z.object({
  attractionId: z.string().min(1).max(100),
  reservedStart: clock, reservedEnd: clock,
  targetEarliest: z.union([clock,z.literal('')]),
  targetLatest: z.union([clock,z.literal('')]),
  earlyMinutes: z.number().int().min(0).max(120).default(15),
});
export function saveBooking(db: DatabaseSync, input: unknown, id?: number, now = Date.now()) {
  const b = bookingInput.parse(input);
  const date = parkDate(now);
  const start = localInstant(date,b.reservedStart), end = localInstant(b.reservedEnd < b.reservedStart ? nextDate(date) : date,b.reservedEnd);
  if (!!b.targetEarliest !== !!b.targetLatest) throw new Error('Enter both target boundaries or leave both empty.');
  const earliest = b.targetEarliest ? localInstant(date,b.targetEarliest) : null;
  const latest = b.targetLatest ? localInstant(date,b.targetLatest) : null;
  if (earliest !== null && latest !== null && latest < earliest) throw new Error('Target latest must be at or after earliest.');
  if (!db.prepare('SELECT 1 FROM attractions WHERE id=?').get(b.attractionId)) throw new Error('Choose a known attraction.');
  db.exec('BEGIN IMMEDIATE');
  try {
    if (id !== undefined) {
      const prior = db.prepare('SELECT visit_date FROM bookings WHERE id=?').get(id);
      if (!prior || prior.visit_date !== date) throw new Error('Only today’s bookings can be edited.');
      db.prepare(`UPDATE bookings SET attraction_id=?,reserved_start=?,reserved_end=?,
        target_earliest_start=?,target_latest_start=?,early_threshold_minutes=?,
        revision=revision+1,watch_state='waiting',updated_at=? WHERE id=?`)
        .run(b.attractionId,start,end,earliest,latest,b.earlyMinutes,now,id);
      db.prepare(`UPDATE push_deliveries SET canceled_at=? WHERE sent_at IS NULL AND canceled_at IS NULL
        AND event_id IN (SELECT id FROM alert_events WHERE booking_id=?)`).run(now,id);
    } else {
      id = Number(db.prepare(`INSERT INTO bookings(attraction_id,visit_date,reserved_start,reserved_end,
        target_earliest_start,target_latest_start,early_threshold_minutes,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(b.attractionId,date,start,end,earliest,latest,b.earlyMinutes,now,now).lastInsertRowid);
    }
    db.exec('COMMIT'); return id;
  } catch(e) { db.exec('ROLLBACK'); throw e; }
}
export function setBookingState(db: DatabaseSync, id: number, state: string, now=Date.now()) {
  if (!['paused','completed','waiting'].includes(state)) throw new Error('Invalid booking state.');
  db.exec('BEGIN IMMEDIATE');
  try {
    const result=db.prepare('UPDATE bookings SET watch_state=?,revision=revision+1,updated_at=? WHERE id=? AND visit_date=?')
      .run(state,now,id,parkDate(now));
    if (!result.changes) throw new Error('Booking not found for today.');
    db.prepare(`UPDATE push_deliveries SET canceled_at=? WHERE sent_at IS NULL AND canceled_at IS NULL
      AND event_id IN (SELECT id FROM alert_events WHERE booking_id=?)`).run(now,id);
    db.exec('COMMIT');
  } catch(e) { db.exec('ROLLBACK'); throw e; }
}
