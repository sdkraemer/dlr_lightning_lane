import { setTimeout } from 'node:timers/promises';
import { openDatabase } from '../../../packages/db/index.ts';
import { probe } from '../../../scripts/probe.ts';
import { evaluateAlerts } from '../../../packages/core/alerts.ts';
import { deliverAlerts } from '../../../packages/core/push.ts';
const seconds = Number(process.env.POLL_INTERVAL_SECONDS ?? 120);
if (!Number.isInteger(seconds) || seconds < 60 || seconds > 120)
  throw new Error('POLL_INTERVAL_SECONDS must be 60–120');
const abort = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => abort.abort());
const db = openDatabase();
try {
  while (!abort.signal.aborted) {
    try {
      db.prepare(
        'INSERT INTO worker_state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET heartbeat_at=excluded.heartbeat_at'
      ).run(Date.now());
      await probe(db, false, undefined, false);
      if (!abort.signal.aborted) {
        evaluateAlerts(db);
        await deliverAlerts(db);
      }
    } catch (error) {
      console.error(
        'Worker cycle failed:',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
    await setTimeout(seconds * 1000, undefined, { signal: abort.signal }).catch(
      (error) => {
        if (error.name !== 'AbortError') throw error;
      }
    );
  }
} finally {
  db.close();
}
