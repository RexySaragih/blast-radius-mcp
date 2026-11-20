import { createSymbol, semanticHash, type SymbolNode } from '../domain/Symbol.js';
import type { AstNode, ExtractOutput, ExtractedRef } from './typescript.js';

export function extractPython(root: AstNode, filePath: string): ExtractOutput {
  const symbols: SymbolNode[] = [];
  const rawRefs: ExtractedRef[] = [];
  walk(root, filePath, null, null, symbols, rawRefs);
  return { symbols, rawRefs };
}

function walk(
  node: AstNode,
  filePath: string,
  enclosingClass: string | null,
  enclosingSymbol: SymbolNode | null,
  symbols: SymbolNode[],
  rawRefs: ExtractedRef[],
): void {
  if (node.type === 'class_definition') {
    const name = identifier(node.childForFieldName('name')) ?? 'Class';
    symbols.push(toSymbol(node, name, 'class', filePath));
    for (let i = 0; i < node.namedChildCount; i += 1) {
      const child = node.namedChild(i);
      if (child) walk(child, filePath, name, enclosingSymbol, symbols, rawRefs);
    }
    return;
  }
  if (node.type === 'function_definition') {
    const name = identifier(node.childForFieldName('name')) ?? 'fn';
    const qualified = enclosingClass ? `${enclosingClass}.${name}` : name;
    const symbol = toSymbol(node, qualified, 'function', filePath);
    symbols.push(symbol);
    const body = node.childForFieldName('body');
    if (body) walk(body, filePath, enclosingClass, symbol, symbols, rawRefs);
    return;
  }
  if (node.type === 'import_from_statement' || node.type === 'import_statement') {
    collectImport(node, filePath, rawRefs);
    return;
  }
  if (node.type === 'call') collectCall(node, filePath, enclosingSymbol, rawRefs);
  for (let i = 0; i < node.namedChildCount; i += 1) {
    const child = node.namedChild(i);
    if (child) walk(child, filePath, enclosingClass, enclosingSymbol, symbols, rawRefs);
  }
}

function collectCall(
  node: AstNode,
  filePath: string,
  enclosingSymbol: SymbolNode | null,
  rawRefs: ExtractedRef[],
): void {
  const callee = node.childForFieldName('function') ?? node.namedChild(0);
  if (!callee) return;
  const attribute = callee.type === 'attribute';
  const name = attribute ? (callee.childForFieldName('attribute')?.text ?? callee.text) : callee.text;
  rawRefs.push({
    kind: 'call',
    name,
    fromSymbolId: enclosingSymbol?.id ?? null,
    sourceFile: filePath,
    targetFile: null,
    importedNames: [],
    dynamic: callee.type !== 'identifier' && !attribute,
    line: node.startPosition.row + 1,
    column: node.startPosition.column,
  });
}

function collectImport(node: AstNode, filePath: string, rawRefs: ExtractedRef[]): void {
  const moduleNode = node.childForFieldName('module_name') ?? node.namedChild(0);
  const moduleName = moduleNode?.text ?? '';
  if (!moduleName) return;
  const importedNames: string[] = [];
  for (let i = 0; i < node.namedChildCount; i += 1) {
    const child = node.namedChild(i);
    if (!child || sameNode(child, moduleNode)) continue;
    const imported = importedName(child);
    if (imported) importedNames.push(imported);
  }
  if (node.type === 'import_statement' && importedNames.length === 0) {
    importedNames.push(moduleName.split('.').at(-1) ?? moduleName);
  }
  rawRefs.push({
    kind: 'import',
    name: importedNames.join(',') || moduleName,
    fromSymbolId: null,
    sourceFile: filePath,
    targetFile: moduleName,
    importedNames,
    dynamic: false,
    line: node.startPosition.row + 1,
    column: node.startPosition.column,
  });
}

function importedName(node: AstNode): string | null {
  if (node.type === 'aliased_import') return node.childForFieldName('alias')?.text ?? node.namedChild(0)?.text ?? null;
  if (node.type === 'dotted_name') return node.namedChild(node.namedChildCount - 1)?.text ?? node.text;
  if (node.type === 'identifier') return node.text;
  return null;
}

function sameNode(left: AstNode, right: AstNode | null): boolean {
  if (!right) return false;
  return (
    left.type === right.type &&
    left.text === right.text &&
    left.startPosition.row === right.startPosition.row &&
    left.startPosition.column === right.startPosition.column
  );
}

function toSymbol(node: AstNode, name: string, kind: 'function' | 'class', filePath: string): SymbolNode {
  const params = node.childForFieldName('parameters');
  const body = node.childForFieldName('body');
  return createSymbol({
    name,
    kind,
    filePath,
    startLine: node.startPosition.row + 1,
    startColumn: node.startPosition.column,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column,
    hash: semanticHash(node.text),
    signatureHash: semanticHash(params?.text ?? ''),
    bodyHash: semanticHash(body?.text ?? node.text),
    isBoundary: false,
    language: 'python',
  });
}

function identifier(node: AstNode | null): string | null {
  return node?.text ?? null;
}
