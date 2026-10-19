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
  versionText: 'Companion v1.2.3',
  legal: '© 2026 Drama Studio',
  remoteResources: [],
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
    '02-sites-top.png',
    '03-control-top.png',
    '04-control-bottom.png',
    '05-settings-top.png',
    '06-settings-bottom.png',
    '07-debug.png',
  ]);
  assert.equal(Object.isFrozen(captureStateFiles), true);
});

test('footer smoke contract accepts the Drama Studio footer', () => {
  assert.doesNotThrow(() =>
    assertFooterSnapshot(footerFixture, { version: '1.2.3' }),
  );
});

test('footer smoke contract rejects stale versions, old owners and remote loads', () => {
  assert.throws(
    () =>
      assertFooterSnapshot(
        { ...footerFixture, versionText: 'Companion v1.2.2' },
        { version: '1.2.3' },
      ),
    /stale/u,
  );
  assert.throws(
    () =>
      assertFooterSnapshot(
        { ...footerFixture, legal: '© 2026 Someone Else' },
        { version: '1.2.3' },
      ),
    /credit Drama Studio/u,
  );
  assert.throws(
    () =>
      assertFooterSnapshot(
        { ...footerFixture, remoteResources: ['https://cdn.example/x.js'] },
        { version: '1.2.3' },
      ),
    /remote resources/u,
  );
});
