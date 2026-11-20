import { createEdge, type Edge } from '../domain/Edge.js';
import { createSymbol, semanticHash, type SymbolNode } from '../domain/Symbol.js';

export type BoundaryTagResult = {
  symbols: SymbolNode[];
  edges: Edge[];
};

const HTTP_METHOD_CALL = /\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/gi;
const NEST_ROUTE = /@(Get|Post|Put|Patch|Delete)\(\s*['"]([^'"]+)['"]\s*\)/gi;
const FASTIFY_ROUTE = /\.route\(\s*\{([\s\S]*?)\}/gi;
const PRODUCER_SEND = /\b(?:producer\.send|channel\.publish|channel\.sendToQueue)\s*\(/gi;
const PRISMA_MODEL = /model\s+([A-Za-z_]\w*)\s*\{([^}]*)\}/g;
const DRIZZLE_TABLE = /(?:pgTable|mysqlTable|sqliteTable)\(\s*['"]([^'"]+)['"]\s*,\s*\{([^}]*)\}/g;
const TYPEORM_COLUMN = /@Column\([^)]*\)\s*(?:readonly\s+)?([A-Za-z_]\w*)/g;
const CREATE_TABLE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)["`]?\s*\(([^;]+)\)/gi;

export function tagTypescriptBoundaries(
  source: string,
  filePath: string,
  symbols: SymbolNode[],
  edges: Edge[],
): BoundaryTagResult {
  const nextSymbols = symbols.map((symbol) => ({ ...symbol }));
  const nextEdges = [...edges];
  const byName = new Map(nextSymbols.map((symbol) => [symbol.name, symbol]));

  tagExpressRoutes(source, filePath, nextSymbols, byName);
  tagNestRoutes(source, filePath, nextSymbols, byName);
  tagFastifyRoutes(source, filePath, nextSymbols, byName);
  tagPrismaModels(source, filePath, nextSymbols);
  tagDrizzleTables(source, filePath, nextSymbols);
  tagTypeOrmColumns(source, filePath, nextSymbols);
  tagSqlCreateTable(source, filePath, nextSymbols);
  tagPublishers(source, filePath, nextSymbols, nextEdges, byName);

  return { symbols: nextSymbols, edges: nextEdges };
}

function tagExpressRoutes(
  source: string,
  filePath: string,
  symbols: SymbolNode[],
  byName: Map<string, SymbolNode>,
): void {
  for (const match of source.matchAll(HTTP_METHOD_CALL)) {
    const label = routeLabel(match[1] ?? '', match[2] ?? '');
    const argSlice = callArguments(source, (match.index ?? 0) + match[0].length);
    bindRoute(symbols, byName, filePath, label, handlerFromArgs(argSlice), match.index ?? 0, source);
  }
}

function tagNestRoutes(
  source: string,
  filePath: string,
  symbols: SymbolNode[],
  byName: Map<string, SymbolNode>,
): void {
  for (const match of source.matchAll(NEST_ROUTE)) {
    const label = routeLabel(match[1] ?? '', match[2] ?? '');
    const methodStart = match.index ?? 0;
    const following = source.slice(methodStart, methodStart + 200);
    const methodName = following.match(/\)\s*(?:async\s+)?([A-Za-z_]\w*)\s*\(/)?.[1] ?? null;
    bindRoute(symbols, byName, filePath, label, methodName, methodStart, source);
  }
}

function tagFastifyRoutes(
  source: string,
  filePath: string,
  symbols: SymbolNode[],
  byName: Map<string, SymbolNode>,
): void {
  for (const match of source.matchAll(FASTIFY_ROUTE)) {
    const block = match[1] ?? '';
    const method = block.match(/method\s*:\s*['"]([A-Za-z]+)['"]/i)?.[1];
    const routePath = block.match(/url\s*:\s*['"]([^'"]+)['"]/)?.[1];
    if (!method || !routePath) continue;
    const inline = /handler\s*:\s*(?:async\s*)?(?:\(|function\b)/.test(block);
    const handlerName = inline ? null : (block.match(/handler\s*:\s*([A-Za-z_]\w*)/)?.[1] ?? null);
    bindRoute(
      symbols,
      byName,
      filePath,
      routeLabel(method, routePath),
      handlerName,
      match.index ?? 0,
      source,
    );
  }
}

function bindRoute(
  symbols: SymbolNode[],
  byName: Map<string, SymbolNode>,
  filePath: string,
  label: string,
  handlerName: string | null,
  index: number,
  source: string,
): void {
  const existing = handlerName ? findHandler(byName, handlerName) : null;
  if (existing) {
    existing.kind = 'route';
    existing.isBoundary = true;
    existing.routeLabel = label;
    return;
  }
  const created = routeSymbol(filePath, handlerName ?? label, index, source, label);
  symbols.push(created);
  byName.set(created.name, created);
}

function callArguments(source: string, start: number): string {
  let depth = 1;
  let quote: string | null = null;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (quote) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index);
    }
  }
  return source.slice(start);
}

function handlerFromArgs(argSlice: string): string | null {
  if (/=>|\bfunction\b/.test(argSlice)) return null;
  const head = argSlice.split(/=>|\{/)[0] ?? '';
  const idents = [...head.matchAll(/\b([A-Za-z_]\w*)\b/g)]
    .map((item) => item[1] ?? '')
    .filter((name) => name.length > 0 && name !== 'async' && name !== 'await');
  return idents.length > 0 ? (idents[idents.length - 1] ?? null) : null;
}

function findHandler(byName: Map<string, SymbolNode>, handlerName: string): SymbolNode | null {
  return (
    byName.get(handlerName) ??
    [...byName.values()].find((symbol) => symbol.name === handlerName || symbol.name.endsWith(`.${handlerName}`)) ??
    null
  );
}

function routeLabel(method: string, routePath: string): string {
  return `${method.toUpperCase()} ${routePath}`;
}

function tagPrismaModels(source: string, filePath: string, symbols: SymbolNode[]): void {
  for (const match of source.matchAll(PRISMA_MODEL)) {
    const body = match[2] ?? '';
    const baseLine = lineAt(source, match.index ?? 0);
    for (const field of body.matchAll(/^\s*([A-Za-z_]\w*)\s+[A-Za-z_]/gm)) {
      const name = field[1];
      if (!name || name === '@@' || name.startsWith('@@')) continue;
      symbols.push(dbColumnSymbol(filePath, name, baseLine + lineOffset(body, field.index ?? 0)));
    }
  }
}

function tagDrizzleTables(source: string, filePath: string, symbols: SymbolNode[]): void {
  for (const match of source.matchAll(DRIZZLE_TABLE)) {
    const body = match[2] ?? '';
    const baseLine = lineAt(source, match.index ?? 0);
    for (const field of body.matchAll(/([A-Za-z_]\w*)\s*:/g)) {
      const name = field[1];
      if (!name) continue;
      symbols.push(dbColumnSymbol(filePath, name, baseLine + lineOffset(body, field.index ?? 0)));
    }
  }
}

function tagTypeOrmColumns(source: string, filePath: string, symbols: SymbolNode[]): void {
  for (const match of source.matchAll(TYPEORM_COLUMN)) {
    const name = match[1];
    if (!name) continue;
    symbols.push(dbColumnSymbol(filePath, name, lineAt(source, match.index ?? 0)));
  }
}

function tagSqlCreateTable(source: string, filePath: string, symbols: SymbolNode[]): void {
  for (const match of source.matchAll(CREATE_TABLE)) {
    const body = match[2] ?? '';
    const baseLine = lineAt(source, match.index ?? 0);
    for (const field of body.matchAll(/^\s*["`]?([A-Za-z_]\w*)["`]?\s+/gm)) {
      const name = field[1];
      if (!name || /^(PRIMARY|FOREIGN|UNIQUE|CONSTRAINT|CHECK|INDEX)$/i.test(name)) continue;
      symbols.push(dbColumnSymbol(filePath, name, baseLine + lineOffset(body, field.index ?? 0)));
    }
  }
}

function tagPublishers(
  source: string,
  filePath: string,
  symbols: SymbolNode[],
  edges: Edge[],
  byName: Map<string, SymbolNode>,
): void {
  for (const match of source.matchAll(PRODUCER_SEND)) {
    const index = match.index ?? 0;
    const enclosing = findEnclosingSymbol(symbols, lineAt(source, index));
    if (enclosing) {
      enclosing.kind = enclosing.kind === 'route' ? enclosing.kind : 'event_handler';
      enclosing.isBoundary = true;
      const target = createSymbol({
        name: `publish@${lineAt(source, index)}`,
        kind: 'event_handler',
        filePath,
        startLine: lineAt(source, index),
        startColumn: 0,
        endLine: lineAt(source, index),
        endColumn: 1,
        hash: semanticHash(match[0] ?? 'publish'),
        signatureHash: semanticHash('()'),
        bodyHash: semanticHash(match[0] ?? 'publish'),
        isBoundary: true,
        language: 'typescript',
      });
      symbols.push(target);
      edges.push(createEdge(enclosing.id, 'publishes', target.id));
      continue;
    }
    const created = createSymbol({
      name: `publisher@${lineAt(source, index)}`,
      kind: 'event_handler',
      filePath,
      startLine: lineAt(source, index),
      startColumn: 0,
      endLine: lineAt(source, index),
      endColumn: 1,
      hash: semanticHash(match[0] ?? 'publish'),
      signatureHash: semanticHash('()'),
      bodyHash: semanticHash(match[0] ?? 'publish'),
      isBoundary: true,
      language: 'typescript',
    });
    symbols.push(created);
    byName.set(created.name, created);
  }
}

function routeSymbol(
  filePath: string,
  name: string,
  index: number,
  source: string,
  label: string,
): SymbolNode {
  const line = lineAt(source, index);
  return createSymbol({
    name,
    kind: 'route',
    filePath,
    startLine: line,
    startColumn: 0,
    endLine: line,
    endColumn: 1,
    hash: semanticHash(label),
    signatureHash: semanticHash(label),
    bodyHash: semanticHash(label),
    isBoundary: true,
    language: 'typescript',
    routeLabel: label,
  });
}

function dbColumnSymbol(filePath: string, name: string, line: number): SymbolNode {
  return createSymbol({
    name,
    kind: 'db_column',
    filePath,
    startLine: line,
    startColumn: 0,
    endLine: line,
    endColumn: 1,
    hash: semanticHash(name),
    signatureHash: semanticHash(name),
    bodyHash: semanticHash(name),
    isBoundary: true,
    language: 'typescript',
  });
}

function findEnclosingSymbol(symbols: SymbolNode[], line: number): SymbolNode | null {
  let best: SymbolNode | null = null;
  for (const symbol of symbols) {
    if (symbol.startLine <= line && symbol.endLine >= line) {
      if (!best || symbol.startLine >= best.startLine) best = symbol;
    }
  }
  return best;
}

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

function lineOffset(body: string, index: number): number {
  return body.slice(0, index).split('\n').length - 1;
}
