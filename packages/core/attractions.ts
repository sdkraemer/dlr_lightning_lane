import type { DatabaseSync } from 'node:sqlite';

// Capability is separate from today's availability. Keep known Multi Pass rides
// selectable when sold out, down, or temporarily missing a queue in the feed.
const supported = `EXISTS (
  SELECT 1 FROM observations o
  JOIN queue_observations q ON q.observation_id=o.id
  WHERE o.attraction_id=a.id AND q.queue_type='RETURN_TIME'
)`;

export function bookingAttractions(db: DatabaseSync) {
  return db.prepare(`SELECT a.*,p.name park_name FROM attractions a
    JOIN parks p ON p.id=a.park_id WHERE ${supported} ORDER BY a.name`).all();
}

export function supportsBooking(db: DatabaseSync, attractionId: string) {
  return Boolean(db.prepare(`SELECT 1 FROM attractions a WHERE a.id=? AND ${supported}`).get(attractionId));
}
