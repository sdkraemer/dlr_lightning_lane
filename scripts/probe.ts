import { pathToFileURL } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase, hasPendingWatch } from '../packages/db/index.ts';
import { PARKS, fetchLive } from '../packages/themeparks/index.ts';

const text = (value: unknown) => typeof value === 'string' ? value : null;
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;

export async function probe(db: DatabaseSync, diagnostic = false, fetcher = fetchLive) {
  if (!diagnostic && (process.env.MONITORING_ENABLED === 'false' || !hasPendingWatch(db))) {
    console.log('Skipped: monitoring disabled or no pending same-day target watches.');
    return { skipped: true, failures: 0 };
  }
  let failures = 0;
  for (const park of PARKS) {
    try {
      const entities = await fetcher(park.id);
      const now = Date.now();
      db.exec('BEGIN IMMEDIATE');
      try {
        const run = db.prepare("INSERT INTO poll_runs(park_id,fetched_at,outcome) VALUES (?,?,'ok')").run(park.id, now).lastInsertRowid;
        for (const e of entities) {
          db.prepare(`INSERT INTO attractions(id,park_id,name) VALUES (?,?,?)
            ON CONFLICT(id) DO UPDATE SET name=excluded.name, park_id=excluded.park_id`).run(e.id,park.id,e.name);
          const obs = db.prepare(`INSERT INTO observations(poll_run_id,attraction_id,observed_at,
            attraction_name,status,standby_wait,api_last_updated,raw_entity_json) VALUES (?,?,?,?,?,?,?,?)`)
            .run(run,e.id,now,e.name,e.status,number(e.queue?.STANDBY?.waitTime),e.lastUpdated ?? null,JSON.stringify(e)).lastInsertRowid;
          for (const [type,q] of Object.entries(e.queue ?? {})) {
            db.prepare(`INSERT INTO queue_observations(observation_id,queue_type,state,wait_minutes,
              return_start,return_end,raw_json) VALUES (?,?,?,?,?,?,?)`)
              .run(obs,type,text(q?.state),number(q?.waitTime),text(q?.returnStart),text(q?.returnEnd),JSON.stringify(q));
          }
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      for (const e of entities) console.log(JSON.stringify({
        park: park.name, attractionId: e.id, attraction: e.name, status: e.status,
        observedAt: new Date(now).toISOString(), lastUpdated: e.lastUpdated,
        queueTypes: Object.keys(e.queue ?? {}),
        RETURN_TIME: e.queue?.RETURN_TIME ?? null,
        PAID_RETURN_TIME: e.queue?.PAID_RETURN_TIME ?? null,
        queues: e.queue ?? null,
      }));
    } catch (error) {
      failures++;
      const message = error instanceof Error ? error.message : String(error);
      db.prepare("INSERT INTO poll_runs(park_id,fetched_at,outcome,error) VALUES (?,?,'error',?)").run(park.id,Date.now(),message);
      console.error(`${park.name}: ${message}`);
    }
  }
  return { skipped: false, failures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = openDatabase();
  try { const result = await probe(db,process.argv.includes('--diagnostic')); process.exitCode = result.failures ? 1 : 0; }
  finally { db.close(); }
}
