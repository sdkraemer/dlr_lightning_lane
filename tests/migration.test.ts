import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openDatabase} from '../packages/db/index.ts';
test('existing initial database upgrades without losing reservations or observation history',()=>{
 const file=join(mkdtempSync(join(tmpdir(),'dlr-migration-')),'test.sqlite');
 const original=new DatabaseSync(file);
 original.exec(readFileSync('packages/db/migrations/001-initial.sql','utf8'));
 original.prepare('INSERT INTO attractions VALUES(?,?,?)').run('ride','7340550b-c14d-4def-80bb-acdb51d49a66','Ride');
 original.prepare("INSERT INTO bookings(attraction_id,visit_date,reserved_start,expires_at,created_at,updated_at) VALUES('ride','2026-10-01',1,2,1,1)").run();
 original.close();
 const db=openDatabase(file);
 try{
 assert.equal(db.prepare('SELECT count(*) n FROM bookings').get()?.n,1);
 assert.equal(db.prepare('SELECT count(*) n FROM schema_migrations').get()?.n,2);
 assert.equal(db.prepare("SELECT count(*) n FROM pragma_table_info('bookings') WHERE name='expires_at'").get()?.n,0);
 }finally{db.close();}
 const again=openDatabase(file);
 assert.equal(again.prepare('SELECT count(*) n FROM schema_migrations').get()?.n,2);
 again.close();
});
