import { openDatabase } from '../packages/db/index.ts';
openDatabase().close();
console.log('SQLite initialized. No watches enabled.');
