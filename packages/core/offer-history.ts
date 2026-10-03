import type { DatabaseSync } from 'node:sqlite';
import { localInstant, nextDate, parkDate } from './time.ts';

export type FarthestOffer = {
  return_start: string;
  return_end: string;
  observed_at: number;
};

// Derive from durable observations, so temporary drops, process restarts and
// booking edits do not erase the high-water mark. No extra mutable table needed.
export function farthestOfferToday(
  db: DatabaseSync,
  attractionId: string,
  queueType = 'RETURN_TIME',
  now = Date.now()
): FarthestOffer | null {
  const date = parkDate(now);
  const dayStart = localInstant(date, '00:00');
  const rows = db.prepare(`
    SELECT o.observed_at,q.return_start,q.return_end
    FROM observations o JOIN queue_observations q ON q.observation_id=o.id
    WHERE o.attraction_id=? AND o.observed_at>=? AND o.observed_at<=?
      AND q.queue_type=? AND q.state='AVAILABLE'
      AND q.return_start IS NOT NULL AND q.return_end IS NOT NULL
    ORDER BY o.observed_at DESC,o.id DESC
  `).all(attractionId, dayStart, now, queueType);
  let maximum: FarthestOffer | null = null;
  let maxStart = -Infinity;
  for (const row of rows) {
    const start = Date.parse(String(row.return_start));
    const end = Date.parse(String(row.return_end));
    const observed = Number(row.observed_at);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start ||
        end <= observed || start < dayStart) continue;
    // Late park operation can offer a return just after midnight.
    if (parkDate(start) !== date && parkDate(start) !== nextDate(date)) continue;
    if (start > maxStart) {
      maxStart = start;
      maximum = {return_start: String(row.return_start), return_end: String(row.return_end), observed_at: observed};
    }
  }
  return maximum;
}
