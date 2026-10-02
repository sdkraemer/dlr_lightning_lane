import {openDatabase} from '../packages/db/index.ts';
import {writeFileSync} from 'node:fs';
const db=openDatabase(':memory:');
try{
 const sql=db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type DESC,rowid").all().map(row=>String(row.sql)+';').join('\n\n');
 writeFileSync('packages/db/schema.sql','-- Current schema reference, generated from versioned migrations.\n-- Runtime initialization uses packages/db/migrations, not this snapshot.\nPRAGMA foreign_keys=ON;\n\n'+sql+'\n');
}finally{db.close();}
