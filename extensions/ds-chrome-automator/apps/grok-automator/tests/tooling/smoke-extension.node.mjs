import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import {
  assertFooterSnapshot,
  captureStateFiles,
  parseSmokeArguments,
} from '../../scripts/smoke-extension.mjs';

const footerFixture = {
  count: 1,
  badgeCount: 1,
  badgeSource:
    'chrome-extension://abcdefghijklmnopabcdefghijklmnop/badges/version.svg',
  badgeAlt: 'Grok Automator™ version 1.2.3',
  badgeLoaded: true,
  copyright: '© 2026 PAKS LLC. ALL RIGHTS RESERVED.',
  remoteShieldsResources: [],
};

test('smoke arguments preserve the original executable-only CLI', () => {
  assert.deepEqual(parseSmokeArguments(['C:\\Chrome\\chrome.exe']), {
    browserPath: 'C:\\Chrome\\chrome.exe',
    captureDir: null,
  });
});

test('smoke arguments resolve an optional capture directory', () => {
  const result = parseSmokeArguments([
    'C:\\Chrome\\chrome.exe',
    '--capture-dir',
    'artifacts/smoke',
  ]);
  assert.equal(result.browserPath, 'C:\\Chrome\\chrome.exe');
  assert.equal(result.captureDir, path.resolve('artifacts/smoke'));
});

test('smoke arguments reject incomplete or unknown capture options', () => {
  assert.throws(() => parseSmokeArguments([]), /Usage:/);
  assert.throws(
    () => parseSmokeArguments(['chrome', '--capture-dir']),
    /Usage:/,
  );
  assert.throws(
    () => parseSmokeArguments(['chrome', '--screenshots', 'artifacts']),
    /Usage:/,
  );
});

test('capture states use deterministic PNG names in workflow order', () => {
  assert.deepEqual(Object.values(captureStateFiles), [
    '01-fresh-tip-modal.png',
    '02-control-top.png',
    '03-control-bottom.png',
    '04-settings-top.png',
    '05-settings-bottom.png',
    '06-debug.png',
    '07-signed-out-run-gate.png',
  ]);
  assert.equal(Object.isFrozen(captureStateFiles), true);
});

test('footer smoke contract accepts one loaded local version shield', () => {
  assert.doesNotThrow(() =>
    assertFooterSnapshot(footerFixture, {
      extensionId: 'abcdefghijklmnopabcdefghijklmnop',
      version: '1.2.3',
    }),
  );
});

test('footer smoke contract rejects remote or unloaded shields', () => {
  assert.throws(
    () =>
      assertFooterSnapshot(
        {
          ...footerFixture,
          badgeSource: 'https://img.shields.io/badge/version-1.2.3-blue',
        },
        {
          extensionId: 'abcdefghijklmnopabcdefghijklmnop',
          version: '1.2.3',
        },
      ),
    /must be local/u,
  );
  assert.throws(
    () =>
      assertFooterSnapshot(
        { ...footerFixture, badgeLoaded: false },
        {
          extensionId: 'abcdefghijklmnopabcdefghijklmnop',
          version: '1.2.3',
        },
      ),
    /did not load with intrinsic dimensions/u,
  );
});
