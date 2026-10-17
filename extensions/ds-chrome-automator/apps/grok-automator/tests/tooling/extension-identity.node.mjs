import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extensionIdFromTargets,
  extensionIdFromUnpackedPath,
} from '../../scripts/lib/extension-identity.mjs';

test('derives the Chromium unpacked ID from a normalized Windows path', () => {
  assert.equal(
    extensionIdFromUnpackedPath('c:\\example\\extension', 'win32'),
    'khljnbaehneoiakcfkbmegihfaokaboc',
  );
  assert.equal(
    extensionIdFromUnpackedPath('C:\\example\\extension', 'win32'),
    'khljnbaehneoiakcfkbmegihfaokaboc',
  );
});

test('rejects an empty unpacked extension path', () => {
  assert.throws(
    () => extensionIdFromUnpackedPath('', 'win32'),
    /must be a non-empty string/u,
  );
});

test('discovers the unpacked extension ID from its background service worker', () => {
  assert.equal(
    extensionIdFromTargets([
      { type: 'page', url: 'about:blank' },
      {
        type: 'service_worker',
        url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/background.js',
      },
    ]),
    'abcdefghijklmnopabcdefghijklmnop',
  );
});

test('ignores page URLs, invalid IDs, and unrelated service workers', () => {
  assert.equal(
    extensionIdFromTargets([
      {
        type: 'page',
        url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/sidepanel.html',
      },
      {
        type: 'service_worker',
        url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/worker.js',
      },
      {
        type: 'service_worker',
        url: 'chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz/background.js',
      },
    ]),
    null,
  );
  assert.equal(extensionIdFromTargets(null), null);
});
