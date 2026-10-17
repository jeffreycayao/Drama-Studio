/** Base64 and hashing for the desktop link, without large string concat. */

const SLICE = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let index = 0; index < bytes.length; index += SLICE) {
    parts.push(String.fromCharCode(...bytes.subarray(index, index + SLICE)));
  }
  return btoa(parts.join(''));
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Never a SharedArrayBuffer here; the cast only satisfies BufferSource.
  const digest = await crypto.subtle.digest(
    'SHA-256',
    bytes as Uint8Array<ArrayBuffer>,
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
