import { test } from 'node:test';
import assert from 'node:assert/strict';
import webpush from 'web-push';
import { vapidConfiguration } from '../packages/core/vapid.ts';
const keys = webpush.generateVAPIDKeys();
const valid = {
  VAPID_PUBLIC_KEY: keys.publicKey,
  VAPID_PRIVATE_KEY: keys.privateKey,
  VAPID_SUBJECT: 'mailto:test@example.com',
};
test('VAPID validates generated matching keys and trims surrounding whitespace', () => {
  assert.equal(vapidConfiguration(valid).configured, true);
  const result = vapidConfiguration({
    ...valid,
    VAPID_PUBLIC_KEY: '  ' + keys.publicKey + '\n',
  });
  assert.equal(result.configured, true);
  assert.equal(result.publicKey, keys.publicKey);
});
test('VAPID rejects placeholders, swapped keys, invalid points and mismatched pairs', () => {
  for (const publicKey of [
    'test',
    keys.privateKey,
    'VAPID_PUBLIC_KEY=' + keys.publicKey,
    'B' + 'A'.repeat(86),
  ]) {
    const result = vapidConfiguration({
      ...valid,
      VAPID_PUBLIC_KEY: publicKey,
    });
    assert.equal(result.configured, false);
    assert.equal(result.publicKey, null);
    assert.equal(result.privateKey, null);
    assert.ok(!result.error?.includes(keys.privateKey));
  }
  assert.equal(
    vapidConfiguration({
      ...valid,
      VAPID_PRIVATE_KEY: webpush.generateVAPIDKeys().privateKey,
    }).configured,
    false
  );
});
test('VAPID rejects missing settings, invalid private scalars and invalid contact URLs', () => {
  assert.equal(vapidConfiguration({}).configured, false);
  assert.equal(
    vapidConfiguration({
      ...valid,
      VAPID_PRIVATE_KEY: Buffer.alloc(32).toString('base64url'),
    }).configured,
    false
  );
  assert.equal(
    vapidConfiguration({ ...valid, VAPID_SUBJECT: 'test' }).configured,
    false
  );
});
