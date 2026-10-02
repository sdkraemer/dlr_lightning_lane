import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function openDatabase(path = process.env.DATABASE_PATH ?? './data/lightning-lane.sqlite') {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  return db;
}

export function hasPendingWatch(db: DatabaseSync, now = Date.now()) {
  return Boolean(db.prepare(`SELECT 1 FROM bookings
    WHERE target_earliest_start IS NOT NULL AND watch_state IN ('waiting','watch')
      AND expires_at > ? AND visit_date = ? LIMIT 1`).get(now,
        new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles',
          year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)));
}
