import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, ensureUser } from '../packages/db/index.ts';
import { PARKS, FeedError } from '../packages/themeparks/index.ts';
import { parkHours, refreshParkHours, type ScheduleEntry } from '../packages/core/park-hours.ts';
import { saveBooking } from '../packages/core/bookings.ts';
import { phaseFor } from '../packages/core/alerts.ts';
const now = Date.parse('2026-10-02T17:00:00Z');
const date = '2026-10-02';
const operating = (openingTime: string, closingTime: string): ScheduleEntry => ({ date, type: 'OPERATING', openingTime, closingTime });

test('park-specific slots respect partial hours, split sessions and midnight, excluding special events', async () => {
  const db = openDatabase(':memory:');
  try {
    await refreshParkHours(db, now, async id => id === PARKS[0].id ? [
      operating('2026-10-02T08:12:00-07:00', '2026-10-02T12:07:00-07:00'),
      operating('2026-10-02T13:00:00-07:00', '2026-10-03T00:17:00-07:00'),
      { ...operating('2026-10-02T07:00:00-07:00', '2026-10-02T08:00:00-07:00'), type: 'EXTRA_HOURS' },
    ] : [operating('2026-10-02T09:00:00-07:00', '2026-10-02T20:00:00-07:00')]);
    const disney = parkHours(db, PARKS[0].id, now);
    assert.equal(disney.slots[0].value, '08:15');
    assert.equal(disney.slots.at(-1)?.value, '00:15');
    assert.equal(disney.slots.at(-1)?.nextDay, true);
    for (const value of ['07:00', '08:10', '12:10', '12:55', '00:20'])
      assert.equal(disney.slots.some(slot => slot.value === value), false);
    const dca = parkHours(db, PARKS[1].id, now);
    assert.equal(dca.slots[0].value, '09:00');
    assert.equal(dca.slots.at(-1)?.value, '19:55');
  } finally { db.close(); }
});

test('schedule cache limits requests, retains recent hours on errors and expires old data', async () => {
  const db = openDatabase(':memory:');
  let calls = 0;
  const fetcher = async () => { calls++; return [operating('2026-10-02T08:00:00-07:00', '2026-10-02T23:00:00-07:00')]; };
  try {
    await refreshParkHours(db, now, fetcher);
    await refreshParkHours(db, now + 1000, fetcher);
    assert.equal(calls, 2);
    await refreshParkHours(db, now + 6 * 3_600_000, async () => { calls++; throw new Error('offline'); });
    assert.equal(parkHours(db, PARKS[0].id, now + 6 * 3_600_000 + 1).status, 'available');
    assert.equal(parkHours(db, PARKS[0].id, now + 6 * 3_600_000 + 1).stale, true);
    await refreshParkHours(db, now + 6 * 3_600_000 + 1000, fetcher);
    assert.equal(calls, 4);
    assert.equal(parkHours(db, PARKS[0].id, now + 24 * 3_600_000 + 1).slots.length, 0);
  } finally { db.close(); }
});

test('missing, malformed and event-only schedules do not produce unrestricted options', async () => {
  const db = openDatabase(':memory:');
  try {
    assert.equal(parkHours(db, PARKS[0].id, now).slots.length, 0);
    await refreshParkHours(db, now, async () => [{ ...operating('2026-10-02T20:00:00-07:00', '2026-10-03T01:00:00-07:00'), type: 'TICKETED_EVENT' }]);
    assert.equal(parkHours(db, PARKS[0].id, now).slots.length, 0);
    await refreshParkHours(db, now + 6 * 3_600_000, async () => [operating('invalid', 'invalid')]);
    assert.equal(parkHours(db, PARKS[0].id, now + 6 * 3_600_000).slots.length, 0);
  } finally { db.close(); }
});

test('schedule retry-after is respected', async () => {
  const db = openDatabase(':memory:');
  try {
    await refreshParkHours(db, now, async () => { throw new FeedError('429', now + 3_600_000); });
    let calls = 0;
    await refreshParkHours(db, now + 600_000, async () => { calls++; return []; });
    assert.equal(calls, 0);
  } finally { db.close(); }
});

test('booking validation uses park hours and assigns after-midnight choices to the next date', async () => {
  const db = openDatabase(':memory:');
  try {
    const user = ensureUser(db, 'hours-test');
    db.prepare('INSERT INTO attractions VALUES(?,?,?)').run('ride', PARKS[0].id, 'Ride');
    const run = db.prepare("INSERT INTO poll_runs(park_id,fetched_at,outcome) VALUES(?,?,'ok')").run(PARKS[0].id, now).lastInsertRowid;
    const obs = db.prepare("INSERT INTO observations(poll_run_id,attraction_id,observed_at,attraction_name,status,raw_entity_json) VALUES(?,'ride',?,'Ride','OPERATING','{}')").run(run, now).lastInsertRowid;
    db.prepare("INSERT INTO queue_observations(observation_id,queue_type,raw_json) VALUES(?,'RETURN_TIME','{}')").run(obs);
    const input = { attractionId: 'ride', reservedStart: '23:00', targetEarliest: '23:55', targetLatest: '00:15', earlyMinutes: 15 };
    assert.throws(() => saveBooking(db, user, input, undefined, now), /hours are unavailable/);
    await refreshParkHours(db, now, async () => [operating('2026-10-02T08:00:00-07:00', '2026-10-03T00:30:00-07:00')]);
    const id = saveBooking(db, user, input, undefined, now);
    const booking = db.prepare('SELECT * FROM bookings WHERE id=?').get(id)!;
    assert.equal(booking.target_latest_start, Date.parse('2026-10-03T00:15:00-07:00'));
    for (const reservedStart of ['07:55', '00:30', '01:00'])
      assert.throws(() => saveBooking(db, user, { ...input, reservedStart }, id, now), /operating hours/);
    assert.throws(() => saveBooking(db, user, { ...input, targetLatest: '07:55' }, id, now), /operating hours/);
    assert.throws(() => saveBooking(db, user, { ...input, targetEarliest: '00:15', targetLatest: '23:55' }, id, now), /at or after earliest/);
    assert.equal(phaseFor({ observed_at: now, status: 'OPERATING', state: 'AVAILABLE', return_start: '2026-10-03T00:05:00-07:00', return_end: '2026-10-03T01:05:00-07:00' }, Number(booking.target_earliest_start), Number(booking.target_latest_start), 15, now), 'reached');
    assert.equal(booking.visit_date, date);
  } finally { db.close(); }
});
