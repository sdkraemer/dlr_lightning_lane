import {openDatabase} from '../packages/db/index.ts';
import {PARKS} from '../packages/themeparks/index.ts';
const db=openDatabase();
try {
 db.prepare('INSERT OR REPLACE INTO attractions VALUES(?,?,?)').run('fixture-space',PARKS[0].id,'Space Mountain');
 const now=Date.now();
 const run=db.prepare("INSERT INTO poll_runs(park_id,fetched_at,outcome) VALUES(?,?,'ok')").run(PARKS[0].id,now).lastInsertRowid;
 const obs=db.prepare("INSERT INTO observations(poll_run_id,attraction_id,observed_at,attraction_name,status,standby_wait,raw_entity_json) VALUES(?,?,?,'Space Mountain','OPERATING',35,'{}')").run(run,'fixture-space',now).lastInsertRowid;
 db.prepare("INSERT INTO queue_observations(observation_id,queue_type,state,return_start,return_end,raw_json) VALUES(?,'RETURN_TIME','AVAILABLE',?,?,'{}')").run(obs,new Date(now+3600000).toISOString(),new Date(now+7200000).toISOString());
}finally{db.close();}
