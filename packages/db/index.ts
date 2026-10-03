import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parkDate } from '../core/time.ts';

export function openDatabase(
  path = process.env.DATABASE_PATH ?? './data/lightning-lane.sqlite'
) {
  if (path !== ':memory:')
    mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(
    'PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;'
  );
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL) STRICT'
    );
    if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version=1').get()) {
      db.exec(
        readFileSync(
          resolve(
            process.env.PROJECT_ROOT ?? process.cwd(),
            'packages/db/migrations/001-initial.sql'
          ),
          'utf8'
        )
      );
      db.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(Date.now());
    }
    if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version=2').get()) {
      db.exec(
        readFileSync(
          resolve(
            process.env.PROJECT_ROOT ?? process.cwd(),
            'packages/db/migrations/002-watch-lifecycle.sql'
          ),
          'utf8'
        )
      );
      db.prepare('INSERT INTO schema_migrations VALUES(2,?)').run(Date.now());
    }
    if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version=3').get()) {
      db.exec(
        readFileSync(
          resolve(
            process.env.PROJECT_ROOT ?? process.cwd(),
            'packages/db/migrations/003-users.sql'
          ),
          'utf8'
        )
      );
      db.prepare('INSERT INTO schema_migrations VALUES(3,?)').run(Date.now());
    }
    if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version=4').get()) {
      db.exec(readFileSync(resolve(process.env.PROJECT_ROOT ?? process.cwd(), 'packages/db/migrations/004-park-schedules.sql'), 'utf8'));
      db.prepare('INSERT INTO schema_migrations VALUES(4,?)').run(Date.now());
    }
    // Never give legacy data to the first person who signs up.
    const legacyOwner = process.env.AUTH0_ALLOWED_SUB?.trim();
    if (legacyOwner && !legacyOwner.includes('replace-me')) {
      const owner = ensureUser(db, legacyOwner);
      db.prepare('UPDATE bookings SET user_id=? WHERE user_id IS NULL').run(
        owner
      );
      db.prepare(
        'UPDATE push_subscriptions SET user_id=? WHERE user_id IS NULL'
      ).run(owner);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }
  return db;
}
export function ensureUser(db: DatabaseSync, subject: string) {
  if (!subject.trim()) throw new Error('User identity required.');
  db.prepare(
    'INSERT OR IGNORE INTO users(auth0_sub,created_at) VALUES(?,?)'
  ).run(subject, Date.now());
  return Number(
    db.prepare('SELECT id FROM users WHERE auth0_sub=?').get(subject)!.id
  );
}
export const eligibleWhere = `user_id IS NOT NULL AND target_earliest_start IS NOT NULL
  AND target_latest_start IS NOT NULL AND watch_state IN ('waiting','watch','reached')
  AND reserved_start NOT BETWEEN target_earliest_start AND target_latest_start
  AND visit_date = ?`;
export function hasPendingWatch(db: DatabaseSync, now = Date.now()) {
  return Boolean(
    db
      .prepare('SELECT 1 FROM bookings WHERE ' + eligibleWhere + ' LIMIT 1')
      .get(parkDate(now))
  );
}
