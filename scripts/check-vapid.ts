import { vapidConfiguration } from '../packages/core/vapid.ts';
const config = vapidConfiguration();
console.log(
  config.configured
    ? 'VAPID configuration is valid: public key, private key, matching pair and subject.'
    : config.error
);
process.exitCode = config.configured ? 0 : 1;
// Never print the key material, especially the private key.
