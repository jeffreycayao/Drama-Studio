import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';

import { crc32, readDeterministicZip } from '../../scripts/lib/zip-reader.mjs';

function createStoredZip(files, { modifiedDate = 0 } = {}) {
  const localRecords = [];
  const centralRecords = [];
  let localOffset = 0;

  for (const [name, value] of files) {
    const nameBuffer = Buffer.from(name);
    const data = Buffer.from(value);
    const checksum = crc32(data);
    const local = Buffer.alloc(30 + nameBuffer.length + data.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(modifiedDate, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuffer.copy(local, 30);
    data.copy(local, 30 + nameBuffer.length);
    localRecords.push(local);

    const central = Buffer.alloc(46 + nameBuffer.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(modifiedDate, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(localOffset, 42);
    nameBuffer.copy(central, 46);
    centralRecords.push(central);
    localOffset += local.length;
  }

  const centralOffset = localOffset;
  const centralSize = centralRecords.reduce(
    (sum, record) => sum + record.length,
    0,
  );
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...localRecords, ...centralRecords, eocd]);
}

test('reads a deterministic ZIP and validates CRC data', () => {
  const zip = createStoredZip([
    ['THIRD_PARTY_NOTICES.md', 'licenses'],
    ['background.js', 'safe'],
    ['manifest.json', '{"manifest_version":3}'],
  ]);
  const entries = readDeterministicZip(zip);
  assert.deepEqual(
    entries.map((entry) => entry.name),
    ['THIRD_PARTY_NOTICES.md', 'background.js', 'manifest.json'],
  );
  assert.equal(entries[2].data.toString('utf8'), '{"manifest_version":3}');
});

test('rejects path traversal entries', () => {
  const zip = createStoredZip([['../manifest.json', '{}']]);
  assert.throws(() => readDeterministicZip(zip), /path traversal/u);
});

test('rejects non-deterministic timestamps', () => {
  const zip = createStoredZip([['manifest.json', '{}']], {
    modifiedDate: 0x21,
  });
  assert.throws(
    () => readDeterministicZip(zip),
    /timestamp fields are not deterministically zeroed/u,
  );
});

test('rejects non-lexical entry order', () => {
  const zip = createStoredZip([
    ['manifest.json', '{}'],
    ['background.js', 'safe'],
  ]);
  assert.throws(() => readDeterministicZip(zip), /lexical order/u);
});
