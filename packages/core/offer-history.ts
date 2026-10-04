import type { DatabaseSync } from 'node:sqlite';
import { localInstant, nextDate, parkDate } from './time.ts';

export type FarthestOffer = {
  id: number;
  return_start: string;
  return_end: string;
  observed_at: number;
};
export type OfferHistory = {
  farthest: FarthestOffer | null;
  points: { observedAt: number; returnStart: number }[];
};
export const TREND_WINDOW = 60 * 60_000;

// Carry the daily maximum through every valid observation, including backward
// offers. Keep a boundary sample so a maximum set before the last hour is retained.
export function offerHistoryToday(
  db: DatabaseSync,
  attractionId: string,
  queueType = 'RETURN_TIME',
  now = Date.now()
): OfferHistory {
  const date = parkDate(now);
  const dayStart = localInstant(date, '00:00');
  const windowStart = Math.max(dayStart, now - TREND_WINDOW);
  const rows = db.prepare(`
    SELECT o.id,o.observed_at,q.return_start,q.return_end
    FROM observations o JOIN queue_observations q ON q.observation_id=o.id
    WHERE o.attraction_id=? AND o.observed_at>=? AND o.observed_at<=?
      AND o.status='OPERATING' AND q.queue_type=? AND q.state='AVAILABLE'
      AND q.return_start IS NOT NULL AND q.return_end IS NOT NULL
    ORDER BY o.observed_at,o.id
  `).all(attractionId, dayStart, now, queueType);
  let farthest: FarthestOffer | null = null;
  let maxStart = -Infinity;
  let boundary: OfferHistory['points'][number] | undefined;
  const points: OfferHistory['points'] = [];
  for (const row of rows) {
    const start = Date.parse(String(row.return_start));
    const end = Date.parse(String(row.return_end));
    const observedAt = Number(row.observed_at);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start ||
        end <= observedAt || start < dayStart) continue;
    if (parkDate(start) !== date && parkDate(start) !== nextDate(date)) continue;
    if (start >= maxStart) {
      maxStart = start;
      farthest = {
        id: Number(row.id), return_start: String(row.return_start),
        return_end: String(row.return_end), observed_at: observedAt,
      };
    }
    const point = { observedAt, returnStart: maxStart };
    if (observedAt < windowStart) boundary = point;
    else if (points.at(-1)?.observedAt === observedAt) points[points.length - 1] = point;
    else points.push(point);
  }
  // Never manufacture a full hour of coverage across an unobserved gap.
  if (boundary && windowStart - boundary.observedAt <= 5 * 60_000 &&
      points[0]?.observedAt !== windowStart) {
    points.unshift({ ...boundary, observedAt: windowStart });
  }
  return { farthest, points };
}

export function farthestOfferToday(
  db: DatabaseSync,
  attractionId: string,
  queueType = 'RETURN_TIME',
  now = Date.now()
): FarthestOffer | null {
  return offerHistoryToday(db, attractionId, queueType, now).farthest;
}

export function targetProgress(start: number, earliest: number, latest: number, margin: number) {
  if (start > latest) return 'passed';
  if (start >= earliest) return 'reached';
  if (start >= earliest - margin * 60_000) return 'approaching';
  return null;
}
