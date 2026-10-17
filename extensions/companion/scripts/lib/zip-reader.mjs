import { inflateRawSync } from 'node:zlib';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MINIMUM_EOCD_SIZE = 22;
const MAXIMUM_COMMENT_SIZE = 65_535;

const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

export function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer)
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function findEndOfCentralDirectory(buffer) {
  const minimumOffset = Math.max(
    0,
    buffer.length - MINIMUM_EOCD_SIZE - MAXIMUM_COMMENT_SIZE,
  );
  for (
    let offset = buffer.length - MINIMUM_EOCD_SIZE;
    offset >= minimumOffset;
    offset -= 1
  ) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  throw new Error('ZIP end-of-central-directory record was not found');
}

function decodeName(buffer, flags) {
  if ((flags & 0x800) === 0 && buffer.some((byte) => byte > 0x7f)) {
    throw new Error('Non-ASCII ZIP paths must use the UTF-8 flag');
  }
  return buffer.toString('utf8');
}

function assertSafeName(name) {
  if (
    name.length === 0 ||
    name.includes('\0') ||
    name.includes('\\') ||
    name.startsWith('/') ||
    /^[a-z]:/iu.test(name) ||
    name.endsWith('/')
  ) {
    throw new Error(
      `Unsafe or non-file ZIP entry name: ${JSON.stringify(name)}`,
    );
  }
  const segments = name.split('/');
  if (
    segments.some(
      (segment) => segment === '' || segment === '.' || segment === '..',
    )
  ) {
    throw new Error(`Unsafe ZIP entry path traversal: ${JSON.stringify(name)}`);
  }
}

function extractEntry(buffer, entry) {
  const offset = entry.localHeaderOffset;
  if (
    offset + 30 > buffer.length ||
    buffer.readUInt32LE(offset) !== LOCAL_SIGNATURE
  ) {
    throw new Error(`Invalid local ZIP header for ${entry.name}`);
  }
  const flags = buffer.readUInt16LE(offset + 6);
  const compression = buffer.readUInt16LE(offset + 8);
  const modifiedTime = buffer.readUInt16LE(offset + 10);
  const modifiedDate = buffer.readUInt16LE(offset + 12);
  const checksum = buffer.readUInt32LE(offset + 14);
  const compressedSize = buffer.readUInt32LE(offset + 18);
  const uncompressedSize = buffer.readUInt32LE(offset + 22);
  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const nameStart = offset + 30;
  const dataStart = nameStart + nameLength + extraLength;
  const dataEnd = dataStart + compressedSize;

  if (
    flags !== entry.flags ||
    compression !== entry.compression ||
    modifiedTime !== entry.modifiedTime ||
    modifiedDate !== entry.modifiedDate ||
    checksum !== entry.checksum ||
    compressedSize !== entry.compressedSize ||
    uncompressedSize !== entry.uncompressedSize
  ) {
    throw new Error(
      `Central and local ZIP metadata disagree for ${entry.name}`,
    );
  }
  if ((flags & 0x09) !== 0) {
    throw new Error(
      `Encrypted or data-descriptor ZIP entries are forbidden: ${entry.name}`,
    );
  }
  if (extraLength !== 0) {
    throw new Error(
      `ZIP local-header extra fields are forbidden: ${entry.name}`,
    );
  }
  if (dataEnd > buffer.length)
    throw new Error(`Truncated ZIP entry: ${entry.name}`);

  const localName = decodeName(
    buffer.subarray(nameStart, nameStart + nameLength),
    flags,
  );
  if (localName !== entry.name) {
    throw new Error(`Central and local ZIP names disagree for ${entry.name}`);
  }

  const compressed = buffer.subarray(dataStart, dataEnd);
  let data;
  if (compression === 0) data = Buffer.from(compressed);
  else if (compression === 8) data = inflateRawSync(compressed);
  else
    throw new Error(
      `Unsupported ZIP compression method ${compression}: ${entry.name}`,
    );

  if (data.length !== uncompressedSize) {
    throw new Error(`Uncompressed size mismatch for ${entry.name}`);
  }
  if (crc32(data) !== checksum)
    throw new Error(`CRC-32 mismatch for ${entry.name}`);

  return { data, dataEnd };
}

export function readDeterministicZip(buffer) {
  if (!Buffer.isBuffer(buffer))
    throw new TypeError('ZIP input must be a Buffer');
  if (buffer.length < MINIMUM_EOCD_SIZE)
    throw new Error('ZIP input is truncated');

  const eocdOffset = findEndOfCentralDirectory(buffer);
  const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
  const centralDisk = buffer.readUInt16LE(eocdOffset + 6);
  const diskEntries = buffer.readUInt16LE(eocdOffset + 8);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  const commentLength = buffer.readUInt16LE(eocdOffset + 20);

  if (eocdOffset + MINIMUM_EOCD_SIZE + commentLength !== buffer.length) {
    throw new Error('ZIP contains trailing data or an invalid archive comment');
  }
  if (commentLength !== 0)
    throw new Error('ZIP archive comments are forbidden');
  if (diskNumber !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) {
    throw new Error('Multi-disk ZIP archives are forbidden');
  }
  if (
    totalEntries === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw new Error('ZIP64 archives are not supported for extension releases');
  }
  if (centralOffset + centralSize !== eocdOffset) {
    throw new Error('ZIP central-directory bounds are invalid');
  }

  const entries = [];
  const names = new Set();
  const foldedNames = new Set();
  let offset = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (
      offset + 46 > eocdOffset ||
      buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE
    ) {
      throw new Error(`Invalid central ZIP header at entry ${index}`);
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const compression = buffer.readUInt16LE(offset + 10);
    const modifiedTime = buffer.readUInt16LE(offset + 12);
    const modifiedDate = buffer.readUInt16LE(offset + 14);
    const checksum = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const entryCommentLength = buffer.readUInt16LE(offset + 32);
    const entryDisk = buffer.readUInt16LE(offset + 34);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const recordEnd =
      offset + 46 + nameLength + extraLength + entryCommentLength;
    if (recordEnd > eocdOffset)
      throw new Error(`Truncated central ZIP header at entry ${index}`);

    const name = decodeName(
      buffer.subarray(offset + 46, offset + 46 + nameLength),
      flags,
    );
    assertSafeName(name);
    if (names.has(name) || foldedNames.has(name.toLowerCase())) {
      throw new Error(`Duplicate or case-colliding ZIP entry: ${name}`);
    }
    names.add(name);
    foldedNames.add(name.toLowerCase());
    if ((flags & 0x09) !== 0)
      throw new Error(`Forbidden ZIP flags for ${name}`);
    if (extraLength !== 0 || entryCommentLength !== 0 || entryDisk !== 0) {
      throw new Error(`Non-deterministic ZIP metadata found for ${name}`);
    }
    if (modifiedTime !== 0 || modifiedDate !== 0) {
      throw new Error(
        `ZIP timestamp fields are not deterministically zeroed for ${name}`,
      );
    }
    if (compression !== 0 && compression !== 8) {
      throw new Error(
        `Unsupported ZIP compression method ${compression}: ${name}`,
      );
    }

    entries.push({
      name,
      flags,
      compression,
      modifiedTime,
      modifiedDate,
      checksum,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    offset = recordEnd;
  }
  if (offset !== eocdOffset)
    throw new Error('ZIP central directory has unparsed data');

  // Match WXT's byte-stable, locale-independent code-unit ordering. Using
  // localeCompare here makes the accepted order depend on the host locale and
  // places uppercase notice files differently from WXT's ZIP writer.
  const sortedNames = [...names].sort();
  if (entries.some((entry, index) => entry.name !== sortedNames[index])) {
    throw new Error('ZIP entries are not in deterministic lexical order');
  }

  let expectedLocalOffset = 0;
  for (const entry of entries) {
    if (entry.localHeaderOffset !== expectedLocalOffset) {
      throw new Error(
        `ZIP local entries are not contiguous and ordered at ${entry.name}`,
      );
    }
    const extracted = extractEntry(buffer, entry);
    entry.data = extracted.data;
    expectedLocalOffset = extracted.dataEnd;
  }
  if (expectedLocalOffset !== centralOffset) {
    throw new Error('ZIP contains hidden data before the central directory');
  }

  return entries;
}
