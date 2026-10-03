import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../packages/db/index.ts';
import { localInstant } from '../packages/core/time.ts';
import { farthestOfferToday } from '../packages/core/offer-history.ts';
const park='7340550b-c14d-4def-80bb-acdb51d49a66';
test('daily farthest offer survives earlier offers, outages and booking-independent history',()=>{
 const db=openDatabase(':memory:');
 try {
 db.prepare('INSERT INTO attractions(id,park_id,name) VALUES(?,?,?)').run('ride',park,'Ride');
 const add=(observed:number,start:string|null,end:string|null,type='RETURN_TIME',state='AVAILABLE')=>{
   const run=db.prepare("INSERT INTO poll_runs(park_id,fetched_at,outcome) VALUES(?,?,'ok')").run(park,observed).lastInsertRowid;
   const obs=db.prepare("INSERT INTO observations(poll_run_id,attraction_id,observed_at,attraction_name,status,raw_entity_json) VALUES(?,'ride',?,'Ride','OPERATING','{}')").run(run,observed).lastInsertRowid;
   db.prepare('INSERT INTO queue_observations(observation_id,queue_type,state,return_start,return_end,raw_json) VALUES(?,?,?,?,?,?)').run(obs,type,state,start,end,'{}');
 };
 const at=(time:string)=>localInstant('2026-10-03',time);
 assert.equal(farthestOfferToday(db,'ride','RETURN_TIME',at('12:00')),null);
 add(localInstant('2026-10-02','23:50'),'2026-10-03T23:00:00-07:00','2026-10-04T00:00:00-07:00');
 add(at('10:00'),'2026-10-03T16:00:00-07:00','2026-10-03T17:00:00-07:00');
 add(at('11:00'),'2026-10-03T14:00:00-07:00','2026-10-03T15:00:00-07:00');
 add(at('11:05'),null,null,'RETURN_TIME','FINISHED');
 add(at('11:10'),'2026-10-03T23:00:00-07:00','2026-10-04T00:00:00-07:00','PAID_RETURN_TIME');
 add(at('11:15'),'invalid','invalid');
 add(at('11:20'),'2026-10-03T22:00:00-07:00','2026-10-03T21:00:00-07:00');
 add(at('11:25'),'2026-10-03T22:00:00-07:00','2026-10-03T23:00:00-07:00','RETURN_TIME','FINISHED');
 add(at('13:00'),'2026-10-03T22:00:00-07:00','2026-10-03T23:00:00-07:00');
 assert.equal(farthestOfferToday(db,'ride','RETURN_TIME',at('12:00'))?.return_start,'2026-10-03T16:00:00-07:00');
 // Compare actual instants, not differently-offset strings.
 add(at('11:30'),'2026-10-04T00:00:00Z','2026-10-04T01:00:00Z');
 assert.equal(farthestOfferToday(db,'ride','RETURN_TIME',at('12:00'))?.return_start,'2026-10-04T00:00:00Z');
 assert.equal(farthestOfferToday(db,'ride','RETURN_TIME',localInstant('2026-10-04','00:01')),null);
 } finally {db.close();}
});
test('Pacific midnight boundary follows daylight saving time',()=>{
 const db=openDatabase(':memory:');
 try {
 db.prepare('INSERT INTO attractions(id,park_id,name) VALUES(?,?,?)').run('ride',park,'Ride');
 const observed=Date.parse('2026-11-01T07:30:00Z'); // 00:30 PDT, before fallback.
 const run=db.prepare("INSERT INTO poll_runs(park_id,fetched_at,outcome) VALUES(?,?,'ok')").run(park,observed).lastInsertRowid;
 const obs=db.prepare("INSERT INTO observations(poll_run_id,attraction_id,observed_at,attraction_name,status,raw_entity_json) VALUES(?,'ride',?,'Ride','OPERATING','{}')").run(run,observed).lastInsertRowid;
 db.prepare("INSERT INTO queue_observations VALUES(?,'RETURN_TIME','AVAILABLE',NULL,'2026-11-01T16:00:00-08:00','2026-11-01T17:00:00-08:00','{}')").run(obs);
 assert.equal(farthestOfferToday(db,'ride','RETURN_TIME',Date.parse('2026-11-01T10:00:00Z'))?.observed_at,observed);
 }finally{db.close();}
});
