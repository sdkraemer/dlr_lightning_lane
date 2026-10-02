import { setTimeout } from 'node:timers/promises';
import { openDatabase } from '../../../packages/db/index.ts';
import { probe } from '../../../scripts/probe.ts';

const seconds = Number(process.env.POLL_INTERVAL_SECONDS ?? 120);
if (!Number.isInteger(seconds) || seconds < 60 || seconds > 120) throw new Error('POLL_INTERVAL_SECONDS must be 60–120');
const abort = new AbortController();
for (const signal of ['SIGINT','SIGTERM'] as const) process.on(signal, () => abort.abort());
const db = openDatabase();
try {
  while (!abort.signal.aborted) {
    await probe(db);
    await setTimeout(seconds * 1000, undefined, { signal: abort.signal }).catch(error => {
      if (error.name !== 'AbortError') throw error;
    });
  }
} finally { db.close(); }
