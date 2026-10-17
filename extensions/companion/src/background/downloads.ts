import { isAllowedGeneratedResourceUrl } from '../security/urls';

const WINDOWS_RESERVED_NAME =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const UNSAFE_FILENAME_CHARACTERS = /[<>:"\\|?*]/g;

function replaceControlCharacters(value: string): string {
  return [...value]
    .map((character) => (character.charCodeAt(0) < 32 ? '_' : character))
    .join('');
}

function sanitizePathSegment(segment: string): string {
  const sanitized = replaceControlCharacters(segment)
    .replace(UNSAFE_FILENAME_CHARACTERS, '_')
    .replace(/[. ]+$/g, '')
    .trim();

  if (!sanitized || sanitized === '.' || sanitized === '..') return '';
  if (WINDOWS_RESERVED_NAME.test(sanitized)) return `_${sanitized}`;
  return sanitized.slice(0, 120);
}

export function sanitizeDownloadPath(
  candidate: string,
  fallback = 'grok-download',
): string {
  const safeSegments = candidate
    .replaceAll('\\', '/')
    .split('/')
    .filter((segment) => segment !== '.' && segment !== '..')
    .map(sanitizePathSegment)
    .filter(Boolean);

  const safeFallback = sanitizePathSegment(fallback) || 'grok-download';
  return safeSegments.join('/').slice(0, 240) || safeFallback;
}

export function isSupportedDownloadUrl(candidate: string): boolean {
  return isAllowedGeneratedResourceUrl(candidate);
}
