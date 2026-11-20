import { createSymbol, semanticHash, type SymbolNode } from '../domain/Symbol.js';
import type { AstNode, ExtractOutput, ExtractedRef } from './typescript.js';

export function extractGo(root: AstNode, filePath: string): ExtractOutput {
  const symbols: SymbolNode[] = [];
  const rawRefs: ExtractedRef[] = [];
  walk(root, filePath, null, symbols, rawRefs);
  return { symbols, rawRefs };
}

function walk(
  node: AstNode,
  filePath: string,
  enclosingSymbol: SymbolNode | null,
  symbols: SymbolNode[],
  rawRefs: ExtractedRef[],
): void {
  let nextEnclosing = enclosingSymbol;
  if (node.type === 'function_declaration' || node.type === 'method_declaration') {
    const nameNode = node.childForFieldName('name');
    const name = nameNode?.text ?? 'fn';
    const symbol = toSymbol(node, name, filePath);
    symbols.push(symbol);
    nextEnclosing = symbol;
  }
  if (node.type === 'call_expression') collectCall(node, filePath, enclosingSymbol, rawRefs);
  for (let i = 0; i < node.namedChildCount; i += 1) {
    const child = node.namedChild(i);
    if (child) walk(child, filePath, nextEnclosing, symbols, rawRefs);
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
  const selector = callee.type === 'selector_expression';
  const name = selector ? fieldName(callee) : callee.text;
  if (!name) return;
  rawRefs.push({
    kind: 'call',
    name,
    fromSymbolId: enclosingSymbol?.id ?? null,
    sourceFile: filePath,
    targetFile: null,
    importedNames: [],
    dynamic: callee.type !== 'identifier' && !selector,
    line: node.startPosition.row + 1,
    column: node.startPosition.column,
  });
}

function fieldName(selector: AstNode): string {
  for (let i = 0; i < selector.namedChildCount; i += 1) {
    const child = selector.namedChild(i);
    if (child?.type === 'field_identifier') return child.text;
  }
  return selector.text;
}

function toSymbol(node: AstNode, name: string, filePath: string): SymbolNode {
  const params = node.childForFieldName('parameters');
  const body = node.childForFieldName('body');
  return createSymbol({
    name,
    kind: 'function',
    filePath,
    startLine: node.startPosition.row + 1,
    startColumn: node.startPosition.column,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column,
    hash: semanticHash(node.text),
    signatureHash: semanticHash(params?.text ?? ''),
    bodyHash: semanticHash(body?.text ?? node.text),
    isBoundary: false,
    language: 'go',
  });
}
