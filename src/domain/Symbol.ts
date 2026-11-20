import { createHash } from 'node:crypto';

export type SymbolKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'variable'
  | 'db_column'
  | 'route'
  | 'event_handler'
  | 'test'
  | 'migration';

export type SymbolNode = {
  id: string;
  name: string;
  kind: SymbolKind;
  filePath: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  hash: string;
  signatureHash: string;
  bodyHash: string;
  isBoundary: boolean;
  language: string;
  routeLabel: string | null;
};

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function makeSymbolId(filePath: string, name: string, startLine: number, startColumn: number): string {
  return sha256Hex(`${filePath}:${name}:${startLine}:${startColumn}`);
}

export function semanticHash(text: string): string {
  return sha256Hex(stripCommentsAndWhitespace(text));
}

export function stripCommentsAndWhitespace(text: string): string {
  const withoutBlock = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const withoutLine = withoutBlock.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const withoutHash = withoutLine.replace(/#[^\n]*/g, '');
  return withoutHash.replace(/\s+/g, '');
}

export function createSymbol(
  input: Omit<SymbolNode, 'id' | 'routeLabel'> & { id?: string; routeLabel?: string | null },
): SymbolNode {
  return {
    ...input,
    routeLabel: input.routeLabel ?? null,
    id: input.id ?? makeSymbolId(input.filePath, input.name, input.startLine, input.startColumn),
  };
}
