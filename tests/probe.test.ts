import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  openDatabase,
  hasPendingWatch,
  ensureUser,
} from '../packages/db/index.ts';
import { probe } from '../scripts/probe.ts';
import { PARKS, FeedError } from '../packages/themeparks/index.ts';

test('no watches means zero API calls', async () => {
  const db = openDatabase(':memory:');
  try {
    let calls = 0;
    const result = await probe(db, false, async () => {
      calls++;
      return [];
    });
    assert.equal(result.skipped, true);
    assert.equal(calls, 0);
  } finally {
    db.close();
  }
});

test('pending gate uses Pacific visit date, target and state', () => {
  const db = openDatabase(':memory:');
  try {
    const now = Date.parse('2026-10-02T04:00:00Z');
    const userId = ensureUser(db, 'test-user');
    db.prepare('INSERT INTO attractions VALUES (?,?,?)').run(
      'ride',
      PARKS[0].id,
      'Ride'
    );
    db.prepare(
      `INSERT INTO bookings(attraction_id,visit_date,reserved_start,target_earliest_start,
      target_latest_start,created_at,updated_at,user_id) VALUES (?,?,?,?,?,?,?,?)`
    ).run(
      'ride',
      '2026-10-01',
      now - 600000,
      now,
      now + 600000,
      now,
      now,
      userId
    );
    assert.equal(hasPendingWatch(db, now), true);
    assert.equal(hasPendingWatch(db, now + 86400000), false);
    for (const date of ['2026-09-30', '2026-10-02']) {
      db.prepare('UPDATE bookings SET visit_date=?').run(date);
      assert.equal(hasPendingWatch(db, now), false);
    }
    db.exec(
      "UPDATE bookings SET visit_date='2026-10-01',watch_state='reached'"
    );
    assert.equal(
      hasPendingWatch(db, now),
      true,
      'an offered target is not a modified reservation'
    );
    for (const reserved of [now, now + 300000, now + 600000]) {
      db.prepare('UPDATE bookings SET reserved_start=?').run(reserved);
      assert.equal(
        hasPendingWatch(db, now),
        false,
        'inclusive target boundaries suppress watching'
      );
    }
    db.prepare('UPDATE bookings SET reserved_start=?').run(now + 600001);
    assert.equal(
      hasPendingWatch(db, now),
      true,
      'either side of the window can be watched'
    );
    db.exec("UPDATE bookings SET watch_state='paused'");
    assert.equal(hasPendingWatch(db, now), false);
    db.exec(
      "UPDATE bookings SET watch_state='waiting',target_earliest_start=NULL,target_latest_start=NULL"
    );
    assert.equal(hasPendingWatch(db, now), false);
  } finally {
    db.close();
  }
});

test('diagnostic preserves nulls, unknown queue types and both return queues; one park failure is isolated', async () => {
  const db = openDatabase(':memory:');
  try {
    const result = await probe(db, true, async (id) => {
      if (id === PARKS[1].id) throw new Error('fixture outage');
      return [
        {
          id: 'ride',
          name: 'Ride',
          entityType: 'ATTRACTION',
          status: 'OPERATING',
          queue: {
            STANDBY: { waitTime: 0 },
            RETURN_TIME: { state: 'FINISHED', returnStart: null },
            PAID_RETURN_TIME: {
              state: 'AVAILABLE',
              returnStart: '2026-10-01T22:00:00-07:00',
            },
            FUTURE_QUEUE: null,
          },
        },
      ];
    });
    assert.equal(result.failures, 1);
    assert.equal(
      db.prepare('SELECT count(*) n FROM queue_observations').get()?.n,
      4
    );
    assert.equal(
      db.prepare('SELECT standby_wait FROM observations').get()?.standby_wait,
      0
    );
    assert.equal(
      db
        .prepare(
          "SELECT return_start FROM queue_observations WHERE queue_type='RETURN_TIME'"
        )
        .get()?.return_start,
      null
    );
    assert.equal(
      db.prepare("SELECT count(*) n FROM poll_runs WHERE outcome='error'").get()
        ?.n,
      1
    );
  } finally {
    db.close();
  }
});

test('park Retry-After is persisted and suppresses the next diagnostic request', async () => {
  const db = openDatabase(':memory:');
  try {
    let calls = 0;
    await probe(
      db,
      true,
      async () => {
        calls++;
        throw new FeedError('HTTP 429', Date.now() + 600000);
      },
      false
    );
    assert.equal(calls, 2);
    await probe(
      db,
      true,
      async () => {
        calls++;
        return [];
      },
      false
    );
    assert.equal(calls, 2);
    assert.equal(
      db
        .prepare('SELECT count(*) n FROM park_poll_state WHERE next_poll_at>?')
        .get(Date.now() + 500000)?.n,
      2
    );
  } finally {
    db.close();
  }
});
