import type { DatabaseSync } from 'node:sqlite';
import { PARKS } from '../packages/themeparks/index.ts';
import { parkDate, localInstant, nextDate } from '../packages/core/time.ts';
export function seedParkHours(db: DatabaseSync, now: number) {
  const date = parkDate(now);
  for (const park of PARKS) {
    const schedule = [{ date, type: 'OPERATING',
      openingTime: new Date(localInstant(date, '08:00')).toISOString(),
      closingTime: new Date(localInstant(nextDate(date), '01:00')).toISOString() }];
    db.prepare('INSERT OR REPLACE INTO park_schedule_cache(park_id,fetched_at,next_attempt_at,schedule_json) VALUES(?,?,?,?)')
      .run(park.id, now, now + 6 * 3_600_000, JSON.stringify(schedule));
  }
}
