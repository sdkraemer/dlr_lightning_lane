import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { PARKS, FeedError } from '../themeparks/index.ts';
import { parkDate, localInstant, nextDate } from './time.ts';

const entry = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.string(),
  openingTime: z.string().datetime({ offset: true }).optional(),
  closingTime: z.string().datetime({ offset: true }).optional(),
}).refine(row => row.type !== 'OPERATING' || (row.openingTime && row.closingTime &&
  Date.parse(row.closingTime) > Date.parse(row.openingTime) &&
  Date.parse(row.closingTime) - Date.parse(row.openingTime) <= 36 * 3_600_000), 'Invalid operating hours');
const scheduleSchema = z.array(entry);
export type ScheduleEntry = z.infer<typeof entry>;
const REFRESH_MS = 6 * 3_600_000;
const MAX_AGE_MS = 24 * 3_600_000;

export async function fetchSchedule(parkId: string): Promise<ScheduleEntry[]> {
  const response = await fetch('https://api.themeparks.wiki/v1/entity/' + parkId + '/schedule', {
    signal: AbortSignal.timeout(10_000),
    headers: { 'User-Agent': 'personal-dlr-monitor/0.1', Accept: 'application/json' },
  });
  if (!response.ok) {
    const retry = response.headers.get('retry-after');
    const retryAt = retry ? (/^\d+$/.test(retry) ? Date.now() + Number(retry) * 1000 : Date.parse(retry)) : 0;
    throw new FeedError('Schedule HTTP ' + response.status, Number.isFinite(retryAt) ? retryAt : 0);
  }
  return scheduleSchema.parse((await response.json()).schedule);
}

// Cached independently of live wait-time polling: new users need hours before
// they can create the first watch. Claim retries before awaiting network I/O.
export async function refreshParkHours(db: DatabaseSync, now = Date.now(), fetcher = fetchSchedule) {
  await Promise.all(PARKS.map(async park => {
    db.prepare('INSERT OR IGNORE INTO park_schedule_cache(park_id) VALUES(?)').run(park.id);
    const claimed = db.prepare('UPDATE park_schedule_cache SET next_attempt_at=? WHERE park_id=? AND next_attempt_at<=?')
      .run(now + 5 * 60_000, park.id, now);
    if (!claimed.changes) return;
    try {
      const schedule = scheduleSchema.parse(await fetcher(park.id));
      db.prepare('UPDATE park_schedule_cache SET fetched_at=?,next_attempt_at=?,schedule_json=? WHERE park_id=?')
        .run(now, now + REFRESH_MS, JSON.stringify(schedule), park.id);
    } catch (error) {
      if (error instanceof FeedError && error.retryAt > now + 5 * 60_000)
        db.prepare('UPDATE park_schedule_cache SET next_attempt_at=? WHERE park_id=?').run(error.retryAt, park.id);
    }
  }));
}

export function parkHours(db: DatabaseSync, parkId: string, now = Date.now()) {
  const date = parkDate(now);
  const cached = db.prepare('SELECT fetched_at,schedule_json FROM park_schedule_cache WHERE park_id=?').get(parkId);
  const fetchedAt = cached?.fetched_at == null ? null : Number(cached.fetched_at);
  const freshEnough = fetchedAt !== null && now - fetchedAt <= MAX_AGE_MS && fetchedAt <= now;
  const schedule: ScheduleEntry[] = freshEnough && cached?.schedule_json ? JSON.parse(String(cached.schedule_json)) : [];
  const windows = schedule.filter(row => row.date === date && row.type === 'OPERATING')
    .map(row => ({ opensAt: Date.parse(row.openingTime!), closesAt: Date.parse(row.closingTime!) }))
    .sort((a, b) => a.opensAt - b.opensAt);
  const slots: { value: string; instant: number; nextDay: boolean }[] = [];
  const seen = new Set<string>();
  for (const day of [date, nextDate(date)]) {
    for (let minutes = 0; minutes < 24 * 60; minutes += 5) {
      const value = String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
      let instant: number;
      try { instant = localInstant(day, value); } catch { continue; } // Exclude ambiguous/nonexistent DST times.
      if (windows.some(window => instant >= window.opensAt && instant < window.closesAt) && !seen.has(value)) {
        slots.push({ value, instant, nextDay: day !== date });
        seen.add(value);
      }
    }
  }
  return { parkId, date, fetchedAt, stale: fetchedAt !== null && now - fetchedAt > REFRESH_MS,
    status: windows.length ? 'available' : 'unavailable', windows, slots };
}
