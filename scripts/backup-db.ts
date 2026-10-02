import {DatabaseSync,backup} from 'node:sqlite';
import {resolve} from 'node:path';
import {mkdirSync,existsSync} from 'node:fs';
const path=resolve(process.env.DATABASE_PATH??'./data/lightning-lane.sqlite');
if(!existsSync(path))throw new Error('Database does not exist.');
mkdirSync('./data/backups',{recursive:true});
const target=resolve('./data/backups/'+new Date().toISOString().replace(/[:.]/g,'-')+'.sqlite');
const db=new DatabaseSync(path,{readOnly:true});
try{await backup(db,target);console.log('Backup saved: '+target);}finally{db.close();}
