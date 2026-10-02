import { openDatabase } from '../packages/db/index.ts';
openDatabase().close();
console.log('SQLite migrations applied; existing bookings preserved.');
