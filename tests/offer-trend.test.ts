import { test } from 'node:test';
import assert from 'node:assert/strict';
import webpush from 'web-push';
import { openDatabase, ensureUser, hasPendingWatch } from '../packages/db/index.ts';
import { localInstant, nextDate, parkDate } from '../packages/core/time.ts';
import { offerHistoryToday } from '../packages/core/offer-history.ts';
import { estimateTarget } from '../packages/core/offer-trend.ts';
import { latestOffer, evaluateAlerts } from '../packages/core/alerts.ts';
import { dashboard } from '../packages/core/dashboard.ts';
import { saveBooking } from '../packages/core/bookings.ts';
import { deliverAlerts } from '../packages/core/push.ts';
import { seedParkHours } from './fixtures.ts';

const date = '2026-10-04';
const at = (time: string) => localInstant(date, time);
const now = at('12:00');
const park = '7340550b-c14d-4def-80bb-acdb51d49a66';
function fixture() {
  const db = openDatabase(':memory:');
  const user = ensureUser(db, 'trend-test-user');
  seedParkHours(db, now);
  db.prepare('INSERT INTO attractions VALUES(?,?,?)').run('ride', park, 'Space Mountain');
  function add(observed: number, start: number | null,
    state = 'AVAILABLE', status = 'OPERATING', queue = 'RETURN_TIME') {
    const run = db.prepare("INSERT INTO poll_runs(park_id,fetched_at,outcome) VALUES(?,?,'ok')")
      .run(park, observed).lastInsertRowid;
    const obs = db.prepare("INSERT INTO observations(poll_run_id,attraction_id,observed_at,attraction_name,status,raw_entity_json) VALUES(?,'ride',?,'Space Mountain',?,'{}')")
      .run(run, observed, status).lastInsertRowid;
    db.prepare('INSERT INTO queue_observations(observation_id,queue_type,state,return_start,return_end,raw_json) VALUES(?,?,?,?,?,?)')
      .run(obs, queue, state, start === null ? null : new Date(start).toISOString(),
        start === null ? null : new Date(start + 3_600_000).toISOString(), '{}');
    return Number(obs);
  }
  const booking = () => saveBooking(db, user, {
    attractionId: 'ride', reservedStart: '17:00', targetEarliest: '16:00',
    targetLatest: '16:30', earlyMinutes: 15,
  }, undefined, now);
  const estimate = (earliest = at('16:00'), latest = at('16:30'), when = now) =>
    estimateTarget(offerHistoryToday(db, 'ride', 'RETURN_TIME', when),
      latestOffer(db, 'ride'), earliest, latest, when);
  return { db, user, add, booking, estimate };
}

test('one-hour trend estimates from the daily maximum, independent of a late booking', () => {
  const f = fixture();
  try {
    // Return starts advance 30 minutes per real hour, ending at 15:00.
    for (let minute = 0; minute <= 60; minute += 5)
      f.add(at('11:00') + minute * 60_000, at('14:30') + minute * 30_000);
    const estimate = f.estimate();
    assert.equal(estimate?.status, 'estimate');
    if (estimate?.status !== 'estimate') throw new Error('Missing forecast');
    assert.equal(estimate.ratePerHour, 30);
    assert.equal(estimate.minutes, 120);
    assert.equal(estimate.reachesAt, at('14:00'));
    f.booking();
    assert.deepEqual(dashboard(f.db, f.user, now).bookings[0].estimate, estimate);
    assert.equal(hasPendingWatch(f.db, now), true);
    f.db.prepare("UPDATE bookings SET watch_state='paused'").run();
    assert.equal(dashboard(f.db, f.user, now).bookings[0].estimate, null);
    f.db.prepare("UPDATE bookings SET watch_state='completed'").run();
    assert.equal(dashboard(f.db, f.user, now).bookings[0].estimate, null);
    f.db.prepare("UPDATE bookings SET watch_state='waiting',reserved_start=?").run(at('16:15'));
    const satisfied = dashboard(f.db, f.user, now).bookings[0];
    assert.equal(satisfied.displayState, 'Booking in target');
    assert.equal(satisfied.estimate, null);
  } finally { f.db.close(); }
});

test('backward offers and recoveries are plateaus, never negative trend samples', () => {
  const f = fixture();
  try {
    const starts = ['14:00', '14:10', '13:00', '13:30', '14:05', '14:20', '14:30'];
    starts.forEach((start, index) => f.add(at('11:00') + index * 10 * 60_000, at(start)));
    const history = offerHistoryToday(f.db, 'ride', 'RETURN_TIME', now);
    assert.deepEqual(history.points.map(point => point.returnStart),
      ['14:00', '14:10', '14:10', '14:10', '14:10', '14:20', '14:30'].map(at));
    assert.equal(f.estimate()?.status, 'estimate');
    // Invalid/unavailable/other-queue data cannot raise the high-water mark.
    f.add(now, at('22:00'), 'AVAILABLE', 'DOWN');
    f.add(now, at('22:00'), 'FINISHED');
    f.add(now, at('22:00'), 'AVAILABLE', 'OPERATING', 'PAID_RETURN_TIME');
    assert.equal(offerHistoryToday(f.db, 'ride', 'RETURN_TIME', now).farthest?.return_start,
      new Date(at('14:30')).toISOString());
  } finally { f.db.close(); }
});

test('a high-water mark before the last hour stays flat through lower offers', () => {
  const f = fixture();
  try {
    f.add(at('10:00'), at('15:00'));
    for (let minute = 0; minute <= 60; minute += 5)
      f.add(at('11:00') + minute * 60_000, at('14:00') + minute * 30_000);
    assert.deepEqual(f.estimate(), { status: 'not_advancing' });
    assert.equal(offerHistoryToday(f.db, 'ride', 'RETURN_TIME', now).points.length, 13);
  } finally { f.db.close(); }
});

test('sparse, gapped, stale, unavailable and very slow trends do not produce misleading ETAs', () => {
  const f = fixture();
  try {
    assert.deepEqual(f.estimate(), { status: 'insufficient_data' });
    f.add(at('11:55'), at('14:00'));
    f.add(now, at('14:05'));
    assert.deepEqual(f.estimate(), { status: 'insufficient_data' });
    f.add(at('11:00'), at('13:55'));
    assert.deepEqual(f.estimate(), { status: 'insufficient_data' });
    assert.deepEqual(f.estimate(at('16:00'), at('16:30'), now + 300_001), { status: 'stale' });
    f.add(now, null, 'FINISHED');
    assert.deepEqual(f.estimate(), { status: 'unavailable' });
  } finally { f.db.close(); }
  const slow = fixture();
  try {
    for (let minute = 0; minute <= 60; minute += 5)
      slow.add(at('11:00') + minute * 60_000, at('14:00') + minute * 1000);
    assert.deepEqual(slow.estimate(), { status: 'too_slow' });
  } finally { slow.db.close(); }
});

test('status and estimates follow the maximum through approach, reach, and passing', () => {
  const f = fixture();
  try {
    f.add(at('11:30'), at('15:50'));
    f.add(now, at('14:00'));
    f.booking();
    assert.equal(dashboard(f.db, f.user, now).bookings[0].displayState, 'Watch');
    f.add(now, at('16:00'));
    f.add(now, at('14:00'));
    let b = dashboard(f.db, f.user, now).bookings[0];
    assert.equal(b.displayState, 'Target reached');
    assert.equal(b.estimate, null);
    assert.equal(b.offer?.return_start, new Date(at('14:00')).toISOString());
    assert.equal(dashboard(f.db, f.user, now + 600_000).bookings[0].displayState, 'Target reached');
    f.add(now, at('16:30'));
    assert.equal(dashboard(f.db, f.user, now).bookings[0].displayState, 'Target reached');
    f.add(now, at('16:35'));
    f.add(now, at('16:15'));
    b = dashboard(f.db, f.user, now).bookings[0];
    assert.equal(b.displayState, 'Target passed');
    assert.equal(b.estimate, null);
    evaluateAlerts(f.db, now);
    assert.equal(f.db.prepare('SELECT count(*) n FROM alert_events').get()?.n, 0);
  } finally { f.db.close(); }
});

test('trend and target instants support next-day returns and reset at Pacific midnight', () => {
  const f = fixture();
  try {
    const lateNow = at('23:00');
    for (let minute = 0; minute <= 60; minute += 5)
      f.add(at('22:00') + minute * 60_000, at('23:00') + minute * 30_000);
    const earliest = localInstant(nextDate(date), '00:00');
    const result = f.estimate(earliest, earliest + 3600_000, lateNow);
    assert.equal(result?.status, 'estimate');
    if (result?.status === 'estimate') assert.equal(result.reachesAt, earliest);
    const midnight = offerHistoryToday(f.db, 'ride', 'RETURN_TIME', localInstant(nextDate(date), '00:00'));
    assert.equal(midnight.farthest, null);
    assert.equal(midnight.points.length, 0);
    assert.equal(parkDate(lateNow), date);
  } finally { f.db.close(); }
});

test('alerts and delivery retain the maximum through dips, with accurate observation provenance', async (t) => {
  t.mock.method(Date, 'now', () => now);
  const keys = webpush.generateVAPIDKeys();
  const previous = [process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY, process.env.VAPID_SUBJECT];
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  process.env.VAPID_SUBJECT = 'mailto:test@example.com';
  const f = fixture();
  try {
    const maximumId = f.add(at('11:30'), at('16:00'));
    f.add(now, at('14:00'));
    f.booking();
    f.db.prepare('INSERT INTO push_subscriptions(endpoint,p256dh,auth,created_at,user_id) VALUES(?,?,?,?,?)')
      .run('https://fcm.googleapis.com/test', 'key', 'auth', now, f.user);
    evaluateAlerts(f.db, now);
    evaluateAlerts(f.db, now);
    const events = f.db.prepare('SELECT * FROM alert_events').all();
    assert.equal(events.length, 1);
    assert.equal(events[0].phase, 'reached');
    assert.equal(events[0].observation_id, maximumId);
    const payloads: object[] = [];
    await deliverAlerts(f.db, now, async (_subscription, payload) => {
      payloads.push(payload);
      return { statusCode: 201, body: '', headers: {} };
    });
    assert.equal(payloads.length, 1);
    assert.match(JSON.stringify(payloads[0]), /latest observed start 4:00 PM/);
    assert.equal(hasPendingWatch(f.db, now), true);
  } finally {
    f.db.close();
    ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'].forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
});

test('historical progress alone cannot notify during stale, down, or invalid current data', () => {
  for (const condition of ['stale', 'DOWN', 'FINISHED', 'invalid']) {
    const f = fixture();
    try {
      f.add(at('11:30'), at('16:00'));
      if (condition === 'DOWN') f.add(now, at('14:00'), 'AVAILABLE', 'DOWN');
      if (condition === 'FINISHED') f.add(now, null, 'FINISHED');
      if (condition === 'invalid') f.add(now, null);
      f.booking();
      evaluateAlerts(f.db, now);
      assert.equal(f.db.prepare('SELECT count(*) n FROM alert_events').get()?.n, 0, condition);
    } finally { f.db.close(); }
  }
});

test('recent and preceding half-hours distinguish accelerating, steady and slowing progress', () => {
  for (const [firstRate, secondRate, pace, low, high] of [
    [0.5, 1.5, 'Picking up', 40, 60],
    [1, 1, 'Steady', 60, 60],
    [1.5, 0.5, 'Slowing down', 60, 120],
  ] as const) {
    const f = fixture();
    try {
      for (let minute = 0; minute <= 60; minute += 5) {
        const advance = Math.min(minute, 30) * firstRate + Math.max(0, minute - 30) * secondRate;
        f.add(at('11:00') + minute * 60_000, at('14:00') + advance * 60_000);
      }
      const result = f.estimate();
      assert.equal(result?.status, 'estimate');
      if (result?.status !== 'estimate') throw new Error('Expected window estimate');
      assert.equal(result.trend.pace, pace);
      assert.equal(result.trend.rate30PerHour, secondRate * 60);
      assert.equal(result.trend.rate60PerHour, 60);
      assert.ok(Math.abs(result.minutesLow - low) < 1e-6);
      assert.ok(Math.abs(result.minutesHigh - high) < 1e-6);
      assert.equal(result.reachesAtLow, now + low * 60_000);
      assert.equal(result.reachesAtHigh, now + high * 60_000);
    } finally { f.db.close(); }
  }
});

test('a single large jump and a recently stalled trend do not get confident forecasts', () => {
  const jump = fixture();
  try {
    for (let minute = 0; minute <= 60; minute += 5)
      jump.add(at('11:00') + minute * 60_000, minute < 55 ? at('14:00') : at('15:00'));
    const result = jump.estimate();
    assert.equal(result?.status, 'recent_jump');
    assert.equal(result?.trend?.pace, 'Recent jump');
  } finally { jump.db.close(); }
  const stalled = fixture();
  try {
    for (let minute = 0; minute <= 60; minute += 5)
      stalled.add(at('11:00') + minute * 60_000, at('14:00') + Math.min(minute, 30) * 60_000);
    const result = stalled.estimate();
    assert.equal(result?.status, 'not_advancing');
    assert.equal(result?.trend?.pace, 'Not advancing');
  } finally { stalled.db.close(); }
});

test('short history labels its coverage without pretending to have two complete windows', () => {
  const f = fixture();
  try {
    for (let minute = 0; minute <= 10; minute += 5)
      f.add(at('11:50') + minute * 60_000, at('15:00') + minute * 60_000);
    const result = f.estimate();
    assert.equal(result?.status, 'estimate');
    if (result?.status !== 'estimate') throw new Error('Expected warming-up estimate');
    assert.equal(result.trend.pace, 'Building trend');
    assert.equal(result.trend.sampledMinutes, 10);
    assert.equal(result.trend.rate30PerHour, null);
  } finally { f.db.close(); }
});
