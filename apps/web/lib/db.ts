import { openDatabase } from '../../../packages/db/index.ts';
let database: ReturnType<typeof openDatabase> | undefined;
export function db() {
  return (database ??= openDatabase());
}
