import webpush from 'web-push';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  openDatabase,
  ensureUser,
  hasPendingWatch,
} from '../packages/db/index.ts';
import { saveBooking, setBookingState } from '../packages/core/bookings.ts';
import { dashboard } from '../packages/core/dashboard.ts';
import { seedParkHours } from './fixtures.ts';
import { evaluateAlerts } from '../packages/core/alerts.ts';
import { deliverAlerts } from '../packages/core/push.ts';
import {
  activeSubscription,
  enableSubscription,
  disableSubscription,
} from '../packages/core/subscriptions.ts';

const now = Date.parse('2026-10-01T17:00:00Z');
const input = {
  attractionId: 'ride',
  reservedStart: '16:00',
  targetEarliest: '15:00',
  targetLatest: '15:30',
  earlyMinutes: 15,
};
const sub = (name: string) => ({
  endpoint: 'https://fcm.googleapis.com/' + name,
  keys: { p256dh: 'key', auth: 'auth' },
});
function fixture() {
  const db = openDatabase(':memory:');
  seedParkHours(db, now);
  const alice = ensureUser(db, 'auth0|alice'),
    bob = ensureUser(db, 'google-oauth2|bob');
  db.prepare('INSERT INTO attractions VALUES(?,?,?)').run(
    'ride',
    '7340550b-c14d-4def-80bb-acdb51d49a66',
    'Space Mountain'
  );
  const run = db
    .prepare(
      "INSERT INTO poll_runs(park_id,fetched_at,outcome) VALUES(? ,?,'ok')"
    )
    .run('7340550b-c14d-4def-80bb-acdb51d49a66', now).lastInsertRowid;
  const obs = db
    .prepare(
      "INSERT INTO observations(poll_run_id,attraction_id,observed_at,attraction_name,status,raw_entity_json) VALUES(?,'ride',?,'Space Mountain','OPERATING','{}')"
    )
    .run(run, now).lastInsertRowid;
  db.prepare(
    "INSERT INTO queue_observations(observation_id,queue_type,state,return_start,return_end,raw_json) VALUES(?,'RETURN_TIME','AVAILABLE','2026-10-01T15:00:00-07:00','2026-10-01T16:00:00-07:00','{}')"
  ).run(obs);
  return { db, alice, bob };
}
test('users have private bookings, watch status, alerts and mutation permissions', () => {
  const { db, alice, bob } = fixture();
  try {
    assert.equal(ensureUser(db, 'auth0|alice'), alice);
    const id = saveBooking(db, alice, input, undefined, now);
    assert.equal(dashboard(db, alice, now).bookings.length, 1);
    assert.equal(dashboard(db, bob, now).bookings.length, 0);
    assert.equal(dashboard(db, bob, now).pollingNeeded, false);
    assert.equal(hasPendingWatch(db, now), true);
    assert.throws(() => saveBooking(db, bob, input, id, now));
    for (const state of ['paused', 'completed', 'waiting'])
      assert.throws(() => setBookingState(db, bob, id, state, now));
    assert.equal(
      db.prepare('SELECT revision FROM bookings WHERE id=?').get(id)?.revision,
      1
    );
    enableSubscription(db, alice, sub('alice'));
    enableSubscription(db, bob, sub('bob'));
    evaluateAlerts(db, now);
    assert.equal(dashboard(db, alice, now).deliveries.length, 1);
    assert.equal(dashboard(db, bob, now).deliveries.length, 0);
    const jobs = db
      .prepare(
        'SELECT s.user_id FROM push_deliveries d JOIN push_subscriptions s ON s.id=d.subscription_id'
      )
      .all();
    assert.deepEqual(
      jobs.map((j) => j.user_id),
      [alice]
    );
    saveBooking(db, bob, input, undefined, now);
    assert.equal(dashboard(db, bob, now).bookings.length, 1);
    assert.equal(dashboard(db, alice, now).bookings.length, 1);
  } finally {
    db.close();
  }
});
test('device ownership cannot be inspected, overwritten or disabled by another user', () => {
  const { db, alice, bob } = fixture();
  try {
    enableSubscription(db, alice, sub('shared-browser'));
    assert.equal(
      activeSubscription(db, bob, sub('shared-browser').endpoint),
      null
    );
    assert.throws(() => enableSubscription(db, bob, sub('shared-browser')));
    disableSubscription(db, bob, sub('shared-browser').endpoint);
    assert.ok(activeSubscription(db, alice, sub('shared-browser').endpoint));
    saveBooking(db, alice, input, undefined, now);
    evaluateAlerts(db, now);
    disableSubscription(db, alice, sub('shared-browser').endpoint, now);
    assert.equal(
      db.prepare('SELECT canceled_at FROM push_deliveries').get()?.canceled_at,
      now
    );
    enableSubscription(db, alice, sub('shared-browser'));
    assert.ok(activeSubscription(db, alice, sub('shared-browser').endpoint));
    enableSubscription(db, bob, sub('new-browser-subscription'));
    assert.ok(
      activeSubscription(db, bob, sub('new-browser-subscription').endpoint)
    );
  } finally {
    db.close();
  }
});
test('delivery rechecks ownership, including mismatched legacy jobs', async (t) => {
  t.mock.method(Date, 'now', () => now);
  const keys = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'];
  const before = keys.map((k) => process.env[k]);
  const vapid = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
  process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
  process.env.VAPID_SUBJECT = 'mailto:test@example.com';
  const { db, alice, bob } = fixture();
  try {
    saveBooking(db, alice, input, undefined, now);
    enableSubscription(db, alice, sub('alice'));
    enableSubscription(db, bob, sub('bob'));
    evaluateAlerts(db, now);
    db.prepare(
      `INSERT INTO push_deliveries(event_id,subscription_id,next_attempt_at)
      SELECT e.id,s.id,? FROM alert_events e CROSS JOIN push_subscriptions s WHERE s.user_id=?`
    ).run(now, bob);
    const sent: string[] = [];
    await deliverAlerts(db, now, async (subscription) => {
      sent.push(subscription.endpoint);
      return {} as never;
    });
    assert.deepEqual(sent, [sub('alice').endpoint]);
    assert.equal(
      db
        .prepare(
          'SELECT canceled_at FROM push_deliveries d JOIN push_subscriptions s ON s.id=d.subscription_id WHERE s.user_id=?'
        )
        .get(bob)?.canceled_at,
      now
    );
  } finally {
    db.close();
    keys.forEach((key, i) => {
      if (before[i] === undefined) delete process.env[key];
      else process.env[key] = before[i];
    });
  }
});
