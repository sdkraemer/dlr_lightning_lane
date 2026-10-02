import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  openDatabase,
  hasPendingWatch,
  ensureUser,
} from '../packages/db/index.ts';
import { saveBooking, setBookingState } from '../packages/core/bookings.ts';
import { parkDate, localInstant } from '../packages/core/time.ts';
import { evaluateAlerts, phaseFor } from '../packages/core/alerts.ts';
import { validPushEndpoint, deliverAlerts } from '../packages/core/push.ts';
const now = Date.parse('2026-10-01T17:00:00Z');
const attraction = 'ride';
function fixture() {
  const db = openDatabase(':memory:');
  ensureUser(db, 'test-user');
  db.prepare('INSERT INTO attractions VALUES(?,?,?)').run(
    attraction,
    '7340550b-c14d-4def-80bb-acdb51d49a66',
    'Space Mountain'
  );
  return db;
}
const input = {
  attractionId: attraction,
  reservedStart: '16:00',
  reservedEnd: '17:00',
  targetEarliest: '15:00',
  targetLatest: '15:30',
  earlyMinutes: 15,
};
test('booking updates suppress watching; yesterday/tomorrow never watch', () => {
  const db = fixture();
  try {
    const id = saveBooking(db, 1, input, undefined, now);
    assert.equal(hasPendingWatch(db, now), true);
    assert.equal(hasPendingWatch(db, now + 86400000), false);
    assert.equal(hasPendingWatch(db, now - 86400000), false);
    saveBooking(
      db,
      1,
      { ...input, reservedStart: '15:00', reservedEnd: '16:00' },
      id,
      now
    );
    assert.equal(hasPendingWatch(db, now), false);
    saveBooking(
      db,
      1,
      { ...input, reservedStart: '15:30', reservedEnd: '16:30' },
      id,
      now
    );
    assert.equal(hasPendingWatch(db, now), false);
    assert.throws(() =>
      saveBooking(db, 1, { ...input, targetEarliest: '16:00' }, id, now)
    );
    assert.throws(() =>
      saveBooking(db, 1, { ...input, targetLatest: '' }, id, now)
    );
    setBookingState(db, 1, id, 'paused', now);
    assert.equal(hasPendingWatch(db, now), false);
  } finally {
    db.close();
  }
});
test('Pacific time handles date boundaries and DST; ambiguous inputs rejected', () => {
  assert.equal(parkDate(Date.parse('2026-10-02T04:00:00Z')), '2026-10-01');
  assert.equal(
    localInstant('2026-01-01', '15:00'),
    Date.parse('2026-01-01T23:00:00Z')
  );
  assert.equal(
    localInstant('2026-07-01', '15:00'),
    Date.parse('2026-07-01T22:00:00Z')
  );
  assert.throws(() => localInstant('2026-03-08', '02:30'));
  assert.throws(() => localInstant('2026-11-01', '01:30'));
});
test('alerts reject missing, stale, down and crossed windows; include boundaries', () => {
  const earliest = localInstant('2026-10-01', '15:00'),
    latest = localInstant('2026-10-01', '15:30');
  const offer = {
    observed_at: now,
    status: 'OPERATING',
    state: 'AVAILABLE',
    return_start: '2026-10-01T15:00:00-07:00',
    return_end: '2026-10-01T16:00:00-07:00',
  };
  assert.equal(phaseFor(offer, earliest, latest, 15, now), 'reached');
  assert.equal(
    phaseFor(
      { ...offer, return_start: '2026-10-01T15:30:00-07:00' },
      earliest,
      latest,
      15,
      now
    ),
    'reached'
  );
  assert.equal(
    phaseFor(
      { ...offer, return_start: '2026-10-01T14:45:00-07:00' },
      earliest,
      latest,
      15,
      now
    ),
    'approaching'
  );
  assert.equal(
    phaseFor(
      { ...offer, return_start: '2026-10-01T15:46:00-07:00' },
      earliest,
      latest,
      15,
      now
    ),
    null
  );
  assert.equal(
    phaseFor({ ...offer, state: 'FINISHED' }, earliest, latest, 15, now),
    null
  );
  assert.equal(
    phaseFor({ ...offer, status: 'DOWN' }, earliest, latest, 15, now),
    null
  );
  assert.equal(
    phaseFor(
      { ...offer, observed_at: now - 300001 },
      earliest,
      latest,
      15,
      now
    ),
    null
  );
});
test('logical alerts deduplicate and editing cancels pending delivery', () => {
  const db = fixture();
  try {
    const id = saveBooking(db, 1, input, undefined, now);
    db.prepare(
      'INSERT INTO push_subscriptions(endpoint,p256dh,auth,created_at,user_id) VALUES(?,?,?,?,1)'
    ).run('https://fcm.googleapis.com/test', 'key', 'auth', now);
    const run = db
      .prepare(
        "INSERT INTO poll_runs(park_id,fetched_at,outcome) VALUES(?,?,'ok')"
      )
      .run('7340550b-c14d-4def-80bb-acdb51d49a66', now).lastInsertRowid;
    const obs = db
      .prepare(
        `INSERT INTO observations(poll_run_id,attraction_id,observed_at,attraction_name,status,raw_entity_json) VALUES(?,?,?,'Space Mountain','OPERATING','{}')`
      )
      .run(run, attraction, now).lastInsertRowid;
    db.prepare(
      `INSERT INTO queue_observations(observation_id,queue_type,state,return_start,return_end,raw_json) VALUES(?,'RETURN_TIME','AVAILABLE','2026-10-01T15:00:00-07:00','2026-10-01T16:00:00-07:00','{}')`
    ).run(obs);
    evaluateAlerts(db, now);
    evaluateAlerts(db, now);
    assert.equal(db.prepare('SELECT count(*) n FROM alert_events').get()?.n, 1);
    assert.equal(
      db.prepare('SELECT count(*) n FROM push_deliveries').get()?.n,
      1
    );
    assert.equal(hasPendingWatch(db, now), true);
    saveBooking(
      db,
      1,
      { ...input, reservedStart: '15:15', reservedEnd: '16:15' },
      id,
      now
    );
    assert.equal(hasPendingWatch(db, now), false);
    assert.equal(
      db.prepare('SELECT canceled_at FROM push_deliveries').get()?.canceled_at,
      now
    );
  } finally {
    db.close();
  }
});
test('push registration cannot target local or arbitrary servers', () => {
  assert.equal(
    validPushEndpoint('https://fcm.googleapis.com/fcm/send/example'),
    true
  );
  for (const url of [
    'http://127.0.0.1',
    'https://localhost',
    'https://fcm.googleapis.com.evil.test/a',
    'https://fcm.googleapis.com:8443/a',
    'https://example.com',
  ])
    assert.equal(validPushEndpoint(url), false);
});

test('same-day reservation start permits an end after midnight', () => {
  const db = fixture();
  try {
    const id = saveBooking(
      db,
      1,
      { ...input, reservedStart: '23:30', reservedEnd: '00:30' },
      undefined,
      now
    );
    const b = db.prepare('SELECT * FROM bookings WHERE id=?').get(id)!;
    assert.equal(Number(b.reserved_end) - Number(b.reserved_start), 3600000);
    assert.equal(b.visit_date, '2026-10-01');
  } finally {
    db.close();
  }
});

test('push sender drops obsolete revisions and disables expired subscriptions', async (t) => {
  t.mock.method(Date, 'now', () => now);
  const previous = [
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
    process.env.VAPID_SUBJECT,
  ];
  process.env.VAPID_PUBLIC_KEY = 'test';
  process.env.VAPID_PRIVATE_KEY = 'test';
  process.env.VAPID_SUBJECT = 'mailto:test@example.com';
  const db = fixture();
  try {
    const id = saveBooking(db, 1, input, undefined, now);
    db.prepare(
      'INSERT INTO push_subscriptions(endpoint,p256dh,auth,created_at,user_id) VALUES(?,?,?,?,1)'
    ).run('https://fcm.googleapis.com/test', 'key', 'auth', now);
    const run = db
      .prepare(
        "INSERT INTO poll_runs(park_id,fetched_at,outcome) VALUES(?,?,'ok')"
      )
      .run('7340550b-c14d-4def-80bb-acdb51d49a66', now).lastInsertRowid;
    const obs = db
      .prepare(
        "INSERT INTO observations(poll_run_id,attraction_id,observed_at,attraction_name,status,raw_entity_json) VALUES(?,?,?,'Ride','OPERATING','{}')"
      )
      .run(run, attraction, now).lastInsertRowid;
    db.prepare(
      "INSERT INTO queue_observations(observation_id,queue_type,state,return_start,return_end,raw_json) VALUES(?,'RETURN_TIME','AVAILABLE','2026-10-01T15:00:00-07:00','2026-10-01T16:00:00-07:00','{}')"
    ).run(obs);
    evaluateAlerts(db, now);
    db.prepare('UPDATE bookings SET revision=revision+1 WHERE id=?').run(id);
    let calls = 0;
    const expired = async () => {
      calls++;
      throw Object.assign(new Error('Gone'), { statusCode: 410 });
    };
    await deliverAlerts(db, now, expired);
    assert.equal(calls, 0);
    assert.equal(
      db.prepare('SELECT canceled_at FROM push_deliveries').get()?.canceled_at,
      now
    );
    evaluateAlerts(db, now);
    await deliverAlerts(db, now, expired);
    assert.equal(calls, 1);
    assert.equal(
      db.prepare('SELECT disabled_at FROM push_subscriptions').get()
        ?.disabled_at,
      now
    );
  } finally {
    db.close();
    for (const [i, key] of [
      'VAPID_PUBLIC_KEY',
      'VAPID_PRIVATE_KEY',
      'VAPID_SUBJECT',
    ].entries()) {
      if (previous[i] === undefined) delete process.env[key];
      else process.env[key] = previous[i];
    }
  }
});
