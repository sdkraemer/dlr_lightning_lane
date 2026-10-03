import { createECDH, ECDH } from 'node:crypto';

export function vapidConfiguration(env: Record<string, string | undefined> = process.env) {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();
  const invalid = (error: string) => ({
    configured: false as const,
    error,
    publicKey: null,
    privateKey: null,
    subject: null,
  });
  if (!publicKey || !privateKey || !subject)
    return invalid(
      'Notifications need VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT on the server.'
    );
  // Strict decoding: Buffer.from alone silently accepts malformed base64.
  if (!/^[A-Za-z0-9_-]{87}$/.test(publicKey))
    return invalid(
      'VAPID_PUBLIC_KEY must be the 87-character base64url public key from npm run vapid:generate.'
    );
  const decoded = Buffer.from(publicKey, 'base64url');
  if (
    decoded.length !== 65 ||
    decoded[0] !== 4 ||
    decoded.toString('base64url') !== publicKey
  )
    return invalid(
      'VAPID_PUBLIC_KEY must encode a 65-byte uncompressed P-256 public key.'
    );
  try {
    ECDH.convertKey(decoded, 'prime256v1');
  } catch {
    return invalid('VAPID_PUBLIC_KEY is not a valid P-256 curve point.');
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(privateKey))
    return invalid(
      'VAPID_PRIVATE_KEY must be the 43-character base64url private key from the same generated pair.'
    );
  const secret = Buffer.from(privateKey, 'base64url');
  if (secret.length !== 32 || secret.toString('base64url') !== privateKey)
    return invalid('VAPID_PRIVATE_KEY has an invalid encoding.');
  try {
    const pair = createECDH('prime256v1');
    pair.setPrivateKey(secret);
    if (!pair.getPublicKey().equals(decoded))
      return invalid(
        'The VAPID public and private keys do not belong to the same pair.'
      );
  } catch {
    return invalid('VAPID_PRIVATE_KEY is not a valid P-256 private key.');
  }
  try {
    const url = new URL(subject);
    if (
      !['mailto:', 'https:'].includes(url.protocol) ||
      (url.protocol === 'mailto:' && !url.pathname.includes('@'))
    )
      return invalid(
        'VAPID_SUBJECT must be a mailto: contact address or HTTPS URL.'
      );
  } catch {
    return invalid(
      'VAPID_SUBJECT must be a mailto: contact address or HTTPS URL.'
    );
  }
  return {
    configured: true as const,
    error: null,
    publicKey,
    privateKey,
    subject,
  };
}
