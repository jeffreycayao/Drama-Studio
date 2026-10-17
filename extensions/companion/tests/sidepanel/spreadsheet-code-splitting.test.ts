import { readFileSync } from 'node:fs';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const spreadsheetModule = '../spreadsheet-import';

function sourceFile(relativePath: string): ts.SourceFile {
  const fileUrl = new URL(relativePath, import.meta.url);
  const vueSource = readFileSync(fileUrl, 'utf8');
  const script = /<script setup lang="ts">([\s\S]*?)<\/script>/.exec(
    vueSource,
  )?.[1];
  if (script === undefined)
    throw new Error(`${relativePath} has no TypeScript setup script.`);
  return ts.createSourceFile(
    fileUrl.pathname,
    script,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function spreadsheetImports(source: ts.SourceFile): ts.ImportDeclaration[] {
  return source.statements
    .filter(ts.isImportDeclaration)
    .filter(
      (statement) =>
        ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === spreadsheetModule,
    );
}

function hasSpreadsheetDynamicImport(source: ts.SourceFile): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.some(
        (argument) =>
          ts.isStringLiteral(argument) && argument.text === spreadsheetModule,
      )
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('spreadsheet runtime code splitting', () => {
  it('loads the parser dynamically from the composer', () => {
    const source = sourceFile(
      '../../src/sidepanel/components/PromptComposer.vue',
    );
    const imports = spreadsheetImports(source);

    expect(imports).toHaveLength(1);
    expect(imports[0]?.importClause?.isTypeOnly).toBe(true);
    expect(hasSpreadsheetDynamicImport(source)).toBe(true);
  });

  it('keeps the modal model-only and free of parser runtime imports', () => {
    const source = sourceFile(
      '../../src/sidepanel/components/SpreadsheetImportModal.vue',
    );
    const imports = spreadsheetImports(source);

    expect(imports).toHaveLength(1);
    expect(imports[0]?.importClause?.isTypeOnly).toBe(true);
    expect(hasSpreadsheetDynamicImport(source)).toBe(false);
  });
});
