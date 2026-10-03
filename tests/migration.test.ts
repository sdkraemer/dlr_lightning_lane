import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  openDatabase,
  ensureUser,
  hasPendingWatch,
} from '../packages/db/index.ts';
import { dashboard } from '../packages/core/dashboard.ts';
test('existing initial database upgrades without losing reservations or observation history', () => {
  const file = join(
    mkdtempSync(join(tmpdir(), 'dlr-migration-')),
    'test.sqlite'
  );
  const original = new DatabaseSync(file);
  original.exec(readFileSync('packages/db/migrations/001-initial.sql', 'utf8'));
  original
    .prepare('INSERT INTO attractions VALUES(?,?,?)')
    .run('ride', '7340550b-c14d-4def-80bb-acdb51d49a66', 'Ride');
  original
    .prepare(
      "INSERT INTO bookings(attraction_id,visit_date,reserved_start,expires_at,created_at,updated_at) VALUES('ride','2026-10-01',1,2,1,1)"
    )
    .run();
  original.close();
  const db = openDatabase(file);
  try {
    assert.equal(db.prepare('SELECT count(*) n FROM bookings').get()?.n, 1);
    assert.equal(
      db.prepare('SELECT count(*) n FROM schema_migrations').get()?.n,
      4
    );
    assert.equal(
      db
        .prepare(
          "SELECT count(*) n FROM pragma_table_info('bookings') WHERE name='expires_at'"
        )
        .get()?.n,
      0
    );
  } finally {
    db.close();
  }
  const again = openDatabase(file);
  assert.equal(
    again.prepare('SELECT count(*) n FROM schema_migrations').get()?.n,
    4
  );
  again.close();
});
test('legacy data is quarantined until explicitly assigned and never reassigned', () => {
  const before = process.env.AUTH0_ALLOWED_SUB;
  const file = join(mkdtempSync(join(tmpdir(), 'dlr-owners-')), 'test.sqlite');
  try {
    delete process.env.AUTH0_ALLOWED_SUB;
    const legacy = new DatabaseSync(file);
    legacy.exec(readFileSync('packages/db/migrations/001-initial.sql', 'utf8'));
    legacy
      .prepare('INSERT INTO attractions VALUES(?,?,?)')
      .run('ride', '7340550b-c14d-4def-80bb-acdb51d49a66', 'Ride');
    legacy.exec(`INSERT INTO bookings(attraction_id,visit_date,reserved_start,target_earliest_start,target_latest_start,expires_at,created_at,updated_at)
    VALUES('ride','2026-10-01',1,2,3,4,1,1);
    INSERT INTO push_subscriptions(endpoint,p256dh,auth,created_at) VALUES('https://fcm.googleapis.com/legacy','key','auth',1);`);
    legacy.close();
    let db = openDatabase(file);
    const stranger = ensureUser(db, 'auth0|first-signup');
    assert.equal(
      db.prepare('SELECT user_id FROM bookings').get()?.user_id,
      null
    );
    assert.equal(
      db.prepare('SELECT user_id FROM push_subscriptions').get()?.user_id,
      null
    );
    assert.equal(
      dashboard(db, stranger, Date.parse('2026-10-01T17:00Z')).bookings.length,
      0
    );
    assert.equal(hasPendingWatch(db, Date.parse('2026-10-01T17:00Z')), false);
    db.close();
    process.env.AUTH0_ALLOWED_SUB = 'auth0|original-owner';
    db = openDatabase(file);
    const owner = ensureUser(db, 'auth0|original-owner');
    assert.equal(
      db.prepare('SELECT user_id FROM bookings').get()?.user_id,
      owner
    );
    assert.equal(
      db.prepare('SELECT user_id FROM push_subscriptions').get()?.user_id,
      owner
    );
    db.close();
    process.env.AUTH0_ALLOWED_SUB = 'auth0|different-owner';
    db = openDatabase(file);
    assert.equal(
      db.prepare('SELECT user_id FROM bookings').get()?.user_id,
      owner
    );
    assert.equal(
      db.prepare('SELECT user_id FROM push_subscriptions').get()?.user_id,
      owner
    );
    db.close();
  } finally {
    if (before === undefined) delete process.env.AUTH0_ALLOWED_SUB;
    else process.env.AUTH0_ALLOWED_SUB = before;
  }
});
