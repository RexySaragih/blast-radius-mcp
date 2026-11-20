import { createSymbol, semanticHash, type SymbolNode } from '../domain/Symbol.js';
import type { AstNode, ExtractOutput, ExtractedRef } from './typescript.js';

const MAPPING =
  /@(GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping|RequestMapping)\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/g;

export function extractJava(root: AstNode, filePath: string, source: string): ExtractOutput {
  const symbols: SymbolNode[] = [];
  const rawRefs: ExtractedRef[] = [];
  walk(root, filePath, null, null, symbols, rawRefs);
  tagSpringRoutes(source, filePath, symbols);
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
  if (node.type === 'class_declaration') {
    const name = node.childForFieldName('name')?.text ?? 'Class';
    const classSymbol = toSymbol(node, name, 'class', filePath, false);
    symbols.push(classSymbol);
    for (let i = 0; i < node.namedChildCount; i += 1) {
      const child = node.namedChild(i);
      if (child) walk(child, filePath, name, classSymbol, symbols, rawRefs);
    }
    return;
  }
  if (node.type === 'method_declaration') {
    const name = node.childForFieldName('name')?.text ?? 'method';
    const qualified = enclosingClass ? `${enclosingClass}.${name}` : name;
    const methodSymbol = toSymbol(node, qualified, 'function', filePath, false);
    symbols.push(methodSymbol);
    const body = node.childForFieldName('body');
    if (body) walk(body, filePath, enclosingClass, methodSymbol, symbols, rawRefs);
    return;
  }
  if (node.type === 'method_invocation') collectCall(node, filePath, enclosingSymbol, rawRefs);
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
  const name = node.childForFieldName('name')?.text ?? invocationName(node);
  if (!name) return;
  rawRefs.push({
    kind: 'call',
    name,
    fromSymbolId: enclosingSymbol?.id ?? null,
    sourceFile: filePath,
    targetFile: null,
    importedNames: [],
    dynamic: false,
    line: node.startPosition.row + 1,
    column: node.startPosition.column,
  });
}

function invocationName(node: AstNode): string {
  let name = '';
  for (let i = 0; i < node.namedChildCount; i += 1) {
    const child = node.namedChild(i);
    if (child?.type === 'identifier') name = child.text;
  }
  return name;
}

function tagSpringRoutes(source: string, filePath: string, symbols: SymbolNode[]): void {
  for (const match of source.matchAll(MAPPING)) {
    const annotation = match[1] ?? 'GetMapping';
    const label = `${springMethod(annotation)} ${match[2] ?? ''}`;
    const after = source.slice(match.index ?? 0, (match.index ?? 0) + 300);
    const methodName = after.match(/\)\s*(?:public|protected|private)?\s*[\w<>,\s\[\]]+\s+(\w+)\s*\(/)?.[1];
    if (!methodName) continue;
    const existing =
      symbols.find((symbol) => symbol.name === methodName || symbol.name.endsWith(`.${methodName}`)) ?? null;
    if (existing) {
      existing.kind = 'route';
      existing.isBoundary = true;
      existing.routeLabel = label;
      continue;
    }
    symbols.push(
      createSymbol({
        name: methodName,
        kind: 'route',
        filePath,
        startLine: 1,
        startColumn: 0,
        endLine: 1,
        endColumn: 1,
        hash: semanticHash(label),
        signatureHash: semanticHash(label),
        bodyHash: semanticHash(label),
        isBoundary: true,
        language: 'java',
        routeLabel: label,
      }),
    );
  }
}

function springMethod(annotation: string): string {
  if (annotation === 'RequestMapping') return 'GET';
  return annotation.replace(/Mapping$/, '').toUpperCase();
}

function toSymbol(
  node: AstNode,
  name: string,
  kind: 'function' | 'class',
  filePath: string,
  isBoundary: boolean,
): SymbolNode {
  return createSymbol({
    name,
    kind,
    filePath,
    startLine: node.startPosition.row + 1,
    startColumn: node.startPosition.column,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column,
    hash: semanticHash(node.text),
    signatureHash: semanticHash(node.childForFieldName('parameters')?.text ?? ''),
    bodyHash: semanticHash(node.childForFieldName('body')?.text ?? node.text),
    isBoundary,
    language: 'java',
  });
}
