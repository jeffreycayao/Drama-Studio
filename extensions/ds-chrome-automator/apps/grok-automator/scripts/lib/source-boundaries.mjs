import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

import {
  PROJECT_ROOT,
  isPathInside,
  toPosixPath,
  walkFiles,
} from './release-common.mjs';

const sourceExtensions = new Set([
  '.cjs',
  '.js',
  '.jsx',
  '.mjs',
  '.ts',
  '.tsx',
  '.vue',
]);
const forbiddenRoots = [
  path.join(PROJECT_ROOT, 'src', 'legacy'),
  path.join(PROJECT_ROOT, 'src', 'recovered'),
  path.join(PROJECT_ROOT, 'forensics'),
];

function scriptFragments(file, source) {
  if (path.extname(file).toLowerCase() !== '.vue') return [source];
  return [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/giu)].map(
    (match) => match[1],
  );
}

export function extractModuleSpecifiers(source, file = 'source.ts') {
  const specifiers = [];
  for (const fragment of scriptFragments(file, source)) {
    const sourceFile = ts.createSourceFile(
      file,
      fragment,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );

    const visit = (node) => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteralLike(node.moduleSpecifier)
      ) {
        specifiers.push(node.moduleSpecifier.text);
      } else if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression &&
        ts.isStringLiteralLike(node.moduleReference.expression)
      ) {
        specifiers.push(node.moduleReference.expression.text);
      } else if (
        ts.isCallExpression(node) &&
        node.arguments.length > 0 &&
        ts.isStringLiteralLike(node.arguments[0]) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === 'require'))
      ) {
        specifiers.push(node.arguments[0].text);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return [...new Set(specifiers)];
}

function referencesForbiddenTree(file, specifier, projectRoot) {
  const cleanSpecifier = specifier.split(/[?#]/u, 1)[0].replaceAll('\\', '/');
  const normalized = cleanSpecifier.toLowerCase().replace(/^\.?\//u, '');
  if (
    /(?:^|\/)src\/(?:legacy|recovered)(?:\/|$)/u.test(normalized) ||
    /(?:^|\/)forensics(?:\/|$)/u.test(normalized) ||
    /^(?:@|~)\/(?:legacy|recovered)(?:\/|$)/u.test(normalized)
  ) {
    return true;
  }

  if (!cleanSpecifier.startsWith('.') && !path.isAbsolute(cleanSpecifier))
    return false;
  const resolved = path.resolve(path.dirname(file), cleanSpecifier);
  const roots = [
    path.join(projectRoot, 'src', 'legacy'),
    path.join(projectRoot, 'src', 'recovered'),
    path.join(projectRoot, 'forensics'),
  ];
  return roots.some((root) => isPathInside(resolved, root));
}

export async function findBoundaryViolations({
  projectRoot = PROJECT_ROOT,
} = {}) {
  const entrypointRoot = path.join(projectRoot, 'entrypoints');
  const sourceRoot = path.join(projectRoot, 'src');
  const excludedSourceRoots = [
    path.join(sourceRoot, 'legacy'),
    path.join(sourceRoot, 'recovered'),
  ];

  const files = [
    ...(await walkFiles(entrypointRoot)),
    ...(await walkFiles(sourceRoot)).filter(
      (file) => !excludedSourceRoots.some((root) => isPathInside(file, root)),
    ),
  ].filter((file) => sourceExtensions.has(path.extname(file).toLowerCase()));

  const violations = [];
  for (const file of [...new Set(files)].sort()) {
    const source = await readFile(file, 'utf8');
    for (const specifier of extractModuleSpecifiers(source, file)) {
      if (!referencesForbiddenTree(file, specifier, projectRoot)) continue;
      violations.push({
        file: toPosixPath(path.relative(projectRoot, file)),
        specifier,
      });
    }
  }

  return violations;
}

export function assertNoBoundaryViolations(violations) {
  if (violations.length === 0) return;
  const details = violations
    .map(
      ({ file, specifier }) => `${file} imports ${JSON.stringify(specifier)}`,
    )
    .join('\n');
  throw new Error(
    `Development source boundary failed with ${violations.length} forbidden import(s):\n${details}`,
  );
}

export function containsForbiddenSourceMarker(text) {
  return /(?:^|[^a-z0-9_])(?:src[\\/](?:legacy|recovered)|forensics[\\/])/iu.test(
    text,
  );
}

export { forbiddenRoots };
