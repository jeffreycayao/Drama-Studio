import assert from 'node:assert/strict';
import test from 'node:test';

import { scanText } from '../../scripts/lib/security-scanner.mjs';

test('allows remote data fetches and callback timers', () => {
  const source = `
    const response = await fetch('https://example.com/config.json');
    setTimeout(refresh, 1000);
  `;
  assert.deepEqual(scanText(source), []);
});

test('detects remote executable code primitives', () => {
  const source = `
    eval(payload);
    new Function(source)();
    import('https://cdn.example.com/plugin.js');
    setInterval('run()', 1000);
  `;
  const rules = scanText(source).map((finding) => finding.rule);
  assert.deepEqual(rules, [
    'eval',
    'function-constructor',
    'remote-dynamic-import',
    'string-timer',
  ]);
});

test('detects remote font stylesheets and runtime font assets', () => {
  const source = `
    @import url('https://fonts.example.test/type.css');
    @font-face { src: url("https://fonts.example.test/body.woff2"); }
    <link rel="stylesheet" href="https://fonts.example.test/type.css">
  `;
  const rules = scanText(source).map((finding) => finding.rule);
  assert.deepEqual(rules, [
    'remote-stylesheet-import',
    'remote-font-asset',
    'remote-stylesheet-link',
  ]);
});

test('detects remote HTML, SVG, and CSS image references', () => {
  const source = `
    <img src="https://img.shields.io/badge/version-1.2.3-blue">
    <source srcset="//cdn.example.test/hero.webp 2x">
    <svg xmlns="http://www.w3.org/2000/svg">
      <image href="https://cdn.example.test/image.png" />
      <use xlink:href="//cdn.example.test/icons.svg#run" />
    </svg>
    .hero { background-image: url(https://cdn.example.test/hero.avif); }
    .avatar { mask-image: url("https://cdn.example.test/asset?id=42"); }
  `;
  const rules = scanText(source).map((finding) => finding.rule);
  assert.deepEqual(rules, [
    'remote-image-element',
    'remote-image-srcset',
    'remote-svg-reference',
    'remote-svg-reference',
    'remote-css-asset',
    'remote-css-asset',
  ]);
});

test('allows local image and SVG references plus the SVG namespace', () => {
  const source = `
    <img src="/badges/version.svg" srcset="/hero.webp 2x">
    <img src="data:image/png;base64,iVBORw0KGgo=">
    <svg xmlns="http://www.w3.org/2000/svg">
      <image href="/icon/128.png" />
      <use href="#run" />
    </svg>
    .hero { background-image: url('/hero.webp'); }
  `;
  assert.deepEqual(scanText(source), []);
});

test('detects high-confidence hardcoded credentials without printing values', () => {
  const findings = scanText(`client_secret = 'super-secret-value'`, {
    file: 'config.ts',
  });
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0], {
    category: 'secret',
    rule: 'hardcoded-secret',
    file: 'config.ts',
    line: 1,
    column: 1,
  });
  assert.equal(JSON.stringify(findings).includes('super-secret-value'), false);
});

test('ignores explicit placeholder credential values', () => {
  assert.deepEqual(scanText(`apiKey = 'replace-me-in-production'`), []);
});
