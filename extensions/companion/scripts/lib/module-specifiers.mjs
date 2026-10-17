import path from 'node:path';
import ts from 'typescript';

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
