export const ALLOWED_UPLOAD_IMAGE_MIME_TYPES = [
  'image/avif',
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

const ALLOWED_UPLOAD_IMAGE_MIME_TYPE_SET = new Set<string>(
  ALLOWED_UPLOAD_IMAGE_MIME_TYPES,
);

export const MAX_UPLOADED_IMAGE_FILES = 20;
export const MAX_UPLOADED_IMAGE_BYTES = 20 * 1_024 * 1_024;
export const MAX_UPLOADED_IMAGE_TOTAL_BYTES = 64 * 1_024 * 1_024;
export const MAX_PREPARED_IMAGE_DATA_URL_CHARS =
  Math.ceil(MAX_UPLOADED_IMAGE_BYTES / 3) * 4 + 64;
export const IMAGE_CHUNK_CHAR_LIMIT = 1_048_576;
export const MAX_IMAGE_SERIALIZED_CHARS =
  MAX_PREPARED_IMAGE_DATA_URL_CHARS + 512;
export const MAX_IMAGE_TRANSFER_CHUNKS = Math.ceil(
  MAX_IMAGE_SERIALIZED_CHARS / IMAGE_CHUNK_CHAR_LIMIT,
);
export const MAX_CONCURRENT_IMAGE_TRANSFERS = 4;
export const IMAGE_TRANSFER_TIMEOUT_MS = 30_000;
export const MAX_PREPARED_IMAGE_TOTAL_CHARS =
  Math.ceil(MAX_UPLOADED_IMAGE_TOTAL_BYTES / 3) * 4 +
  MAX_UPLOADED_IMAGE_FILES * 64;

export function isAllowedUploadImageMimeType(value: string): boolean {
  return ALLOWED_UPLOAD_IMAGE_MIME_TYPE_SET.has(value.toLowerCase());
}

export function estimateBase64DataUrlBytes(value: string): number {
  const separator = value.indexOf(',');
  if (separator < 0) return Number.POSITIVE_INFINITY;
  const payload = value.slice(separator + 1);
  const paddingBytes = payload.endsWith('==')
    ? 2
    : payload.endsWith('=')
      ? 1
      : 0;
  return Math.max(0, (payload.length / 4) * 3 - paddingBytes);
}
