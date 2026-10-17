import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

function deriveKey(secret: string, purpose: string): Buffer {
  return createHash('sha256')
    .update(purpose)
    .update('\0')
    .update(secret)
    .digest();
}

export function createOpaqueId(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hashSessionToken(token: string, pepper: string): string {
  return sha256(`${pepper}\0${token}`);
}

export function createPrivacyKey(
  secret: string,
  purpose: string,
  values: readonly string[],
): string {
  const hmac = createHmac(
    'sha256',
    deriveKey(secret, `faceless-privacy-${purpose}-v1`),
  );
  for (const value of values) {
    hmac.update(value.length.toString(10), 'ascii');
    hmac.update(':', 'ascii');
    hmac.update(value, 'utf8');
    hmac.update('\0', 'ascii');
  }
  return hmac.digest('hex');
}

export function createExtensionUserCode(): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = randomBytes(8);
  const characters = [...bytes].map(
    (value) => alphabet[value & 31] ?? alphabet[0],
  );
  return `${characters.slice(0, 4).join('')}-${characters.slice(4).join('')}`;
}

export function createCsrfToken(sessionId: string, pepper: string): string {
  return createHmac('sha256', deriveKey(pepper, 'faceless-csrf-v1'))
    .update(sessionId, 'utf8')
    .digest('base64url');
}

export function createPkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function encryptTransient(plainText: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    'aes-256-gcm',
    deriveKey(secret, 'faceless-oauth-transient-v1'),
    iv,
  );
  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptTransient(cipherText: string, secret: string): string {
  const parts = cipherText.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Invalid transient value');
  }
  const ivPart = parts[1];
  const tagPart = parts[2];
  const encryptedPart = parts[3];
  if (
    ivPart === undefined ||
    tagPart === undefined ||
    encryptedPart === undefined
  ) {
    throw new Error('Invalid transient value');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    deriveKey(secret, 'faceless-oauth-transient-v1'),
    Buffer.from(ivPart, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
