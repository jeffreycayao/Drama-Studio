import { createHash } from 'node:crypto';

const unpackedBackgroundTargetPattern =
  /^chrome-extension:\/\/([a-p]{32})\/background\.js(?:[?#].*)?$/u;

const hexadecimalToExtensionAlphabet = (hexadecimal) =>
  hexadecimal.replace(/[0-9a-f]/gu, (character) =>
    String.fromCharCode('a'.charCodeAt(0) + Number.parseInt(character, 16)),
  );

export function extensionIdFromUnpackedPath(
  unpackedPath,
  platform = process.platform,
) {
  if (typeof unpackedPath !== 'string' || unpackedPath.length === 0) {
    throw new TypeError(
      'The unpacked extension path must be a non-empty string',
    );
  }

  const normalizedPath =
    platform === 'win32' && /^[a-z]:/u.test(unpackedPath)
      ? `${unpackedPath[0].toUpperCase()}${unpackedPath.slice(1)}`
      : unpackedPath;
  const pathBytes = Buffer.from(
    normalizedPath,
    platform === 'win32' ? 'utf16le' : 'utf8',
  );
  const identifierHexadecimal = createHash('sha256')
    .update(pathBytes)
    .digest('hex')
    .slice(0, 32);

  return hexadecimalToExtensionAlphabet(identifierHexadecimal);
}

export function extensionIdFromTargets(targets) {
  if (!Array.isArray(targets)) return null;

  for (const target of targets) {
    if (target?.type !== 'service_worker' || typeof target.url !== 'string') {
      continue;
    }
    const match = unpackedBackgroundTargetPattern.exec(target.url);
    if (match) return match[1];
  }

  return null;
}
