import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { isTextFile, toPosixPath, walkFiles } from './release-common.mjs';

const remoteCodeRules = [
  ['eval', /\beval\s*\(/gu],
  ['function-constructor', /\bnew\s+Function\s*\(/gu],
  ['string-timer', /\bset(?:Timeout|Interval)\s*\(\s*['"`]/gu],
  ['remote-dynamic-import', /\bimport\s*\(\s*['"`]https?:\/\//giu],
  [
    'remote-static-import',
    /\b(?:import|export)\s+[^;'"`]*?\bfrom\s*['"`]https?:\/\//giu,
  ],
  ['remote-side-effect-import', /\bimport\s*['"`]https?:\/\//giu],
  ['remote-import-scripts', /\bimportScripts\s*\(\s*['"`]https?:\/\//giu],
  ['remote-worker', /\b(?:Worker|SharedWorker)\s*\(\s*['"`]https?:\/\//giu],
  ['remote-script-element', /<script\b[^>]*\bsrc\s*=\s*['"]https?:\/\//giu],
  [
    'remote-script-property',
    /\.src\s*=\s*['"`]https?:\/\/[^'"`]+\.m?js(?:[?#][^'"`]*)?['"`]/giu,
  ],
  ['remote-stylesheet-import', /@import\s+(?:url\(\s*)?['"]?https?:\/\//giu],
  [
    'remote-stylesheet-link',
    /<link\b(?=[^>]*\brel\s*=\s*['"]stylesheet['"])(?=[^>]*\bhref\s*=\s*['"]https?:\/\/)[^>]*>/giu,
  ],
  [
    'remote-font-asset',
    /url\(\s*['"]?https?:\/\/[^)'"\s]+\.(?:woff2?|ttf|otf)(?:[?#][^)'"\s]*)?['"]?\s*\)/giu,
  ],
  ['remote-image-element', /<img\b[^>]*\bsrc\s*=\s*['"](?:https?:)?\/\//giu],
  [
    'remote-image-srcset',
    /<(?:img|source)\b[^>]*\bsrcset\s*=\s*['"][^'"]*(?:https?:)?\/\//giu,
  ],
  [
    'remote-svg-reference',
    /<(?:image|use)\b[^>]*\b(?:href|xlink:href)\s*=\s*['"](?:https?:)?\/\//giu,
  ],
  ['remote-css-asset', /url\(\s*['"]?(?:https?:)?\/\/[^)'"]+['"]?\s*\)/giu],
  ['remote-wasm', /https?:\/\/[^\s'"`)]+\.wasm(?:[?#][^\s'"`)]+)?/giu],
];

const secretRules = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/gu],
  ['aws-access-key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/gu],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/gu],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{30,}\b/gu],
  ['npm-token', /\bnpm_[A-Za-z0-9]{30,}\b/gu],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/gu],
  ['stripe-live-key', /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/gu],
  [
    'hardcoded-secret',
    /\b(?:api[_-]?key|client[_-]?secret|secret[_-]?key|password|passwd|access[_-]?token|auth[_-]?token)\b\s*[:=]\s*['"`]([^'"`\r\n]{8,})['"`]/giu,
  ],
];

function locationFor(text, index) {
  const before = text.slice(0, index);
  const line = before.split('\n').length;
  const lineStart = before.lastIndexOf('\n') + 1;
  return { line, column: index - lineStart + 1 };
}

function isPlaceholderSecret(value) {
  const normalized = value.toLowerCase().replaceAll(/[^a-z0-9]+/gu, '_');
  return [
    'changeme',
    'dummy',
    'example',
    'fake',
    'not_a_real',
    'placeholder',
    'replace_me',
    'sample',
    'your_',
  ].some((marker) => normalized.includes(marker));
}

export function scanText(
  text,
  { file = '<memory>', remoteCode = true, secrets = true } = {},
) {
  const findings = [];
  const enabledRules = [
    ...(remoteCode
      ? remoteCodeRules.map(([id, pattern]) => ['remote-code', id, pattern])
      : []),
    ...(secrets
      ? secretRules.map(([id, pattern]) => ['secret', id, pattern])
      : []),
  ];

  for (const [category, rule, pattern] of enabledRules) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      if (rule === 'remote-css-asset') {
        const prefix = text.slice(Math.max(0, match.index - 80), match.index);
        if (
          /@import\s*$/iu.test(prefix) ||
          /\.(?:woff2?|ttf|otf)(?:[?#][^)'"\s]*)?/iu.test(match[0])
        ) {
          continue;
        }
      }
      if (
        category === 'secret' &&
        rule === 'hardcoded-secret' &&
        isPlaceholderSecret(match[1])
      ) {
        continue;
      }
      const { line, column } = locationFor(text, match.index);
      findings.push({ category, rule, file, line, column });
    }
  }

  return findings.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.column - right.column ||
      left.rule.localeCompare(right.rule),
  );
}

export async function scanPaths(
  roots,
  { baseDirectory, exclude, remoteCode = true, secrets = true } = {},
) {
  const files = [];
  for (const root of roots) {
    const candidateFiles = (await walkFiles(root)).filter(
      (file) => isTextFile(file) && !exclude?.(file),
    );
    files.push(...candidateFiles);
  }

  const findings = [];
  for (const file of [...new Set(files)].sort()) {
    const displayFile = baseDirectory
      ? toPosixPath(path.relative(baseDirectory, file))
      : toPosixPath(file);
    const text = await readFile(file, 'utf8');
    findings.push(
      ...scanText(text, { file: displayFile, remoteCode, secrets }),
    );
  }
  return findings;
}

export function formatFindings(findings) {
  return findings
    .map(
      ({ category, rule, file, line, column }) =>
        `${file}:${line}:${column} [${category}/${rule}]`,
    )
    .join('\n');
}

export function assertNoFindings(findings, label) {
  if (findings.length === 0) return;
  throw new Error(
    `${label} failed with ${findings.length} finding(s):\n${formatFindings(findings)}`,
  );
}
