// Run against a mock-auth server with the same fresh, isolated DATABASE_PATH.
import assert from 'node:assert/strict';
import { request } from '@playwright/test';
import { openDatabase, ensureUser } from '../packages/db/index.ts';
import { saveBooking } from '../packages/core/bookings.ts';
import {
  enableSubscription,
  activeSubscription,
} from '../packages/core/subscriptions.ts';
if (!process.env.DATABASE_PATH || !process.env.BROWSER_BASE_URL)
  throw new Error('Set isolated DATABASE_PATH and BROWSER_BASE_URL.');
const base = process.env.BROWSER_BASE_URL;
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  throw new Error('Local preview only.');
const db = openDatabase();
const api = await request.newContext({
  baseURL: base,
  extraHTTPHeaders: { origin: new URL(base).origin },
});
const booking = {
  attractionId: 'fixture-space',
  reservedStart: '23:00',
  targetEarliest: '23:10',
  targetLatest: '23:30',
  earlyMinutes: 15,
};
try {
  const me = ensureUser(db, 'local-preview'),
    other = ensureUser(db, 'auth0|other-api-user');
  const id = saveBooking(db, other, booking);
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/other-api-device',
    keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) },
  };
  enableSubscription(db, other, subscription);
  let response = await api.get('/api/dashboard');
  assert.equal(response.status(), 200);
  assert.ok(
    (await response.json()).bookings.every(
      (b) => b.user_id === me && b.id !== id
    )
  );
  for (const state of ['paused', 'waiting', 'completed']) {
    response = await api.post('/api/bookings', {
      data: { action: 'state', id, state, userId: other },
    });
    assert.equal(response.status(), 400);
  }
  response = await api.post('/api/bookings', {
    data: { id, booking, userId: other },
  });
  assert.equal(response.status(), 400);
  response = await api.post('/api/bookings', {
    data: { booking, userId: other },
  });
  assert.equal(response.status(), 200);
  const created = (await response.json()).id;
  assert.equal(
    db.prepare('SELECT user_id FROM bookings WHERE id=?').get(created).user_id,
    me
  );
  response = await api.post('/api/push', {
    data: { action: 'status', subscription, userId: other },
  });
  assert.deepEqual(await response.json(), { enabled: false });
  response = await api.post('/api/push', {
    data: { action: 'disable', subscription, userId: other },
  });
  assert.equal(response.status(), 200);
  assert.ok(activeSubscription(db, other, subscription.endpoint));
  console.log(
    'API isolation passed: dashboard filtering, edit/state denial, ignored client identity, private device status and disable.'
  );
} finally {
  db.close();
  await api.dispose();
}
