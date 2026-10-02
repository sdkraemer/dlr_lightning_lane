import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, hasPendingWatch } from '../packages/db/index.ts';
import { probe } from '../scripts/probe.ts';
import { PARKS } from '../packages/themeparks/index.ts';

test('no watches means zero API calls', async () => {
  const db = openDatabase(':memory:');
  try {
    let calls = 0;
    const result = await probe(db, false, async () => { calls++; return []; });
    assert.equal(result.skipped,true);
    assert.equal(calls,0);
  } finally { db.close(); }
});

test('pending gate uses Pacific visit date, target, state and expiry', () => {
  const db = openDatabase(':memory:');
  try {
    const now = Date.parse('2026-10-02T04:00:00Z');
    db.prepare('INSERT INTO attractions VALUES (?,?,?)').run('ride',PARKS[0].id,'Ride');
    db.prepare(`INSERT INTO bookings(attraction_id,visit_date,reserved_start,target_earliest_start,
      target_latest_start,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run('ride','2026-10-01',now,now,now+600000,now+3600000,now,now);
    assert.equal(hasPendingWatch(db,now),true);
    assert.equal(hasPendingWatch(db,now+3600000),false);
    db.exec("UPDATE bookings SET watch_state='paused'");
    assert.equal(hasPendingWatch(db,now),false);
    db.exec("UPDATE bookings SET watch_state='waiting',target_earliest_start=NULL,target_latest_start=NULL");
    assert.equal(hasPendingWatch(db,now),false);
  } finally { db.close(); }
});

test('diagnostic preserves nulls, unknown queue types and both return queues; one park failure is isolated', async () => {
  const db = openDatabase(':memory:');
  try {
    const result = await probe(db,true,async id => {
      if (id === PARKS[1].id) throw new Error('fixture outage');
      return [{ id:'ride',name:'Ride',entityType:'ATTRACTION',status:'OPERATING',
        queue:{ STANDBY:{waitTime:0},RETURN_TIME:{state:'FINISHED',returnStart:null},
          PAID_RETURN_TIME:{state:'AVAILABLE',returnStart:'2026-10-01T22:00:00-07:00'},FUTURE_QUEUE:null } }];
    });
    assert.equal(result.failures,1);
    assert.equal(db.prepare('SELECT count(*) n FROM queue_observations').get()?.n,4);
    assert.equal(db.prepare('SELECT standby_wait FROM observations').get()?.standby_wait,0);
    assert.equal(db.prepare("SELECT return_start FROM queue_observations WHERE queue_type='RETURN_TIME'").get()?.return_start,null);
    assert.equal(db.prepare("SELECT count(*) n FROM poll_runs WHERE outcome='error'").get()?.n,1);
  } finally { db.close(); }
});
