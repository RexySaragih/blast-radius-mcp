import { createEdge, type Edge } from '../../domain/Edge.js';
import type { SymbolNode } from '../../domain/Symbol.js';
import type { ParseResult, RawRef } from '../ports/outbound/SourceParserPort.js';

export type LinkSymbolsInput = {
  parses: ParseResult[];
  /** Symbols in files that are not being reparsed, used only as resolution targets. */
  externalSymbols?: SymbolNode[];
  /** Workspace package name to its source entry file. */
  packageEntries?: Map<string, string>;
};

export type LinkSymbolsOutput = {
  edges: Edge[];
  unresolvedCalls: number;
  parses: ParseResult[];
};

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs', '.py', '.go', '.java'] as const;

export class LinkSymbols {
  execute(input: LinkSymbolsInput): LinkSymbolsOutput {
    const symbols = [
      ...input.parses.flatMap((parse) => parse.symbols),
      ...(input.externalSymbols ?? []),
    ];
    const byFile = indexByFile(symbols);
    const context: LinkContext = {
      byFile,
      packageEntries: input.packageEntries ?? new Map(),
      refsByFile: refsByFile(input.parses),
    };
    const importBindings = buildImportBindings(input.parses, context);
    const edges: Edge[] = [];
    const edgeKeys = new Set<string>();
    let unresolvedCalls = 0;

    const addEdge = (sourceId: string, type: Edge['type'], targetId: string): void => {
      const edge = createEdge(sourceId, type, targetId);
      if (edgeKeys.has(edge.id)) return;
      edgeKeys.add(edge.id);
      edges.push(edge);
    };

    for (const parse of input.parses) {
      for (const ref of parse.rawRefs) {
        if (ref.kind === 'implements') {
          linkImplements(ref, symbols, addEdge);
          continue;
        }
        if (ref.kind === 'import') {
          linkImport(ref, context, addEdge);
          continue;
        }
        if (ref.kind !== 'call') continue;
        if (ref.dynamic || !ref.fromSymbolId) {
          unresolvedCalls += 1;
          continue;
        }
        const target = resolveCallTarget(ref, context, importBindings);
        if (!target) {
          unresolvedCalls += 1;
          continue;
        }
        addEdge(ref.fromSymbolId, 'calls', target.id);
      }
    }

    const parses = input.parses.map((parse) => ({
      ...parse,
      edges: edges.filter((edge) =>
        parse.symbols.some((symbol) => symbol.id === edge.sourceId || symbol.id === edge.targetId),
      ),
      unresolvedRefCount: countUnresolvedForFile(parse.rawRefs, context, importBindings),
    }));

    return { edges, unresolvedCalls, parses };
  }
}

function filePathOf(parse: ParseResult): string {
  return parse.symbols[0]?.filePath ?? parse.rawRefs[0]?.sourceFile ?? '';
}

function indexByFile(symbols: SymbolNode[]): Map<string, SymbolNode[]> {
  const map = new Map<string, SymbolNode[]>();
  for (const symbol of symbols) {
    const list = map.get(symbol.filePath) ?? [];
    list.push(symbol);
    map.set(symbol.filePath, list);
  }
  return map;
}

type ImportBinding = { localName: string; target: SymbolNode };

type LinkContext = {
  byFile: Map<string, SymbolNode[]>;
  packageEntries: Map<string, string>;
  refsByFile: Map<string, RawRef[]>;
};

function refsByFile(parses: ParseResult[]): Map<string, RawRef[]> {
  const refs = new Map<string, RawRef[]>();
  for (const parse of parses) {
    const sourceFile = filePathOf(parse);
    if (sourceFile) refs.set(sourceFile, parse.rawRefs);
  }
  return refs;
}

function buildImportBindings(parses: ParseResult[], context: LinkContext): Map<string, ImportBinding[]> {
  const bindings = new Map<string, ImportBinding[]>();
  for (const parse of parses) {
    const sourceFile = filePathOf(parse);
    const fileBindings: ImportBinding[] = [];
    for (const ref of parse.rawRefs) {
      if (ref.kind !== 'import' || !ref.targetFile) continue;
      const resolvedPath = resolveModule(ref.sourceFile, ref.targetFile, context);
      if (!resolvedPath) continue;
      for (const localName of ref.importedNames) {
        const target = resolveImportedSymbol(localName, ref.name, resolvedPath, context);
        if (target) fileBindings.push({ localName, target });
      }
    }
    bindings.set(sourceFile, fileBindings);
  }
  return bindings;
}

function resolveImportedSymbol(
  publicName: string,
  originalName: string,
  resolvedPath: string,
  context: LinkContext,
): SymbolNode | null {
  const direct = findNamed(context.byFile.get(resolvedPath) ?? [], publicName);
  if (direct) return direct;
  for (const ref of context.refsByFile.get(resolvedPath) ?? []) {
    if (ref.kind !== 'import' || !ref.targetFile?.startsWith('.') || !ref.importedNames.includes(publicName)) {
      continue;
    }
    const hopped = resolveModule(ref.sourceFile, ref.targetFile, context);
    if (!hopped) continue;
    const symbol = findNamed(context.byFile.get(hopped) ?? [], ref.name || originalName);
    if (symbol) return symbol;
  }
  return findNamed(context.byFile.get(resolvedPath) ?? [], originalName);
}

function findNamed(symbols: SymbolNode[], name: string): SymbolNode | null {
  return symbols.find((symbol) => symbol.name === name || symbol.name.endsWith(`.${name}`)) ?? null;
}

function resolveModule(fromFile: string, specifier: string, context: LinkContext): string | null {
  if (!specifier.startsWith('.')) {
    return (
      resolveSiblingModule(fromFile, specifier, context.byFile) ??
      resolveRepoPath(specifier, context) ??
      context.packageEntries.get(specifier) ??
      null
    );
  }
  const base = normalizePosix(joinPosix(dirnamePosix(fromFile), specifier));
  if (fileKnown(base, context)) return base;
  for (const ext of SOURCE_EXTENSIONS) {
    if (fileKnown(`${base}${ext}`, context)) return `${base}${ext}`;
  }
  const withoutExt = base.replace(/\.(js|jsx|mjs|cjs|ts|tsx|mts|cts)$/u, '');
  for (const ext of SOURCE_EXTENSIONS) {
    if (fileKnown(`${withoutExt}${ext}`, context)) return `${withoutExt}${ext}`;
  }
  return null;
}

function fileKnown(filePath: string, context: LinkContext): boolean {
  return context.byFile.has(filePath) || context.refsByFile.has(filePath);
}

function resolveCallTarget(
  ref: RawRef,
  context: LinkContext,
  importBindings: Map<string, ImportBinding[]>,
): SymbolNode | null {
  const byFile = context.byFile;
  const sameFile = byFile.get(ref.sourceFile) ?? [];
  const local =
    sameFile.find((symbol) => symbol.name === ref.name) ??
    sameFile.find((symbol) => symbol.name.endsWith(`.${ref.name}`)) ??
    null;
  if (local && local.id !== ref.fromSymbolId) return local;

  const bindings = importBindings.get(ref.sourceFile) ?? [];
  const imported = bindings.find((binding) => binding.localName === ref.name);
  if (imported) return imported.target;

  for (const binding of bindings) {
    const importedFile = byFile.get(binding.target.filePath) ?? [];
    const method =
      importedFile.find((symbol) => symbol.name === `${binding.target.name}.${ref.name}`) ??
      importedFile.find((symbol) => symbol.name.endsWith(`.${ref.name}`)) ??
      null;
    if (method) return method;
  }
  if (ref.sourceFile.endsWith('.go')) return resolveSameDirectory(ref, byFile);
  return null;
}

function resolveSameDirectory(ref: RawRef, byFile: Map<string, SymbolNode[]>): SymbolNode | null {
  const dir = dirnamePosix(ref.sourceFile);
  const matches: SymbolNode[] = [];
  for (const [filePath, symbols] of byFile) {
    if (filePath === ref.sourceFile || dirnamePosix(filePath) !== dir) continue;
    for (const symbol of symbols) {
      if (symbol.name === ref.name || symbol.name.endsWith(`.${ref.name}`)) matches.push(symbol);
    }
  }
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

function linkImplements(
  ref: RawRef,
  symbols: SymbolNode[],
  addEdge: (sourceId: string, type: Edge['type'], targetId: string) => void,
): void {
  if (!ref.fromSymbolId) return;
  const target =
    symbols.find((symbol) => symbol.name === ref.name && symbol.filePath === ref.sourceFile) ??
    symbols.find((symbol) => symbol.name === ref.name) ??
    null;
  if (!target) return;
  addEdge(ref.fromSymbolId, 'implements', target.id);
}

function linkImport(
  ref: RawRef,
  context: LinkContext,
  addEdge: (sourceId: string, type: Edge['type'], targetId: string) => void,
): void {
  if (!ref.targetFile) return;
  const resolved = resolveModule(ref.sourceFile, ref.targetFile, context);
  if (!resolved) return;
  const sourceSymbols = context.byFile.get(ref.sourceFile) ?? [];
  const source = sourceSymbols[0];
  if (!source) return;
  for (const localName of ref.importedNames) {
    const target = resolveImportedSymbol(localName, ref.name, resolved, context);
    if (target) addEdge(source.id, 'imports', target.id);
  }
}

function countUnresolvedForFile(
  refs: RawRef[],
  context: LinkContext,
  importBindings: Map<string, ImportBinding[]>,
): number {
  let count = 0;
  for (const ref of refs) {
    if (ref.kind !== 'call') continue;
    if (ref.dynamic || !ref.fromSymbolId || !resolveCallTarget(ref, context, importBindings)) {
      count += 1;
    }
  }
  return count;
}

function resolveRepoPath(specifier: string, context: LinkContext): string | null {
  const normalized = specifier.replace(/\\/gu, '/').replace(/^\.\//u, '');
  const stems = [
    stripScriptExtension(normalized.replace(/(^|\/)dist\//u, '$1src/')),
    stripScriptExtension(normalized),
  ];
  for (const stem of stems) {
    if (fileKnown(stem, context)) return stem;
    for (const ext of SOURCE_EXTENSIONS) {
      if (fileKnown(`${stem}${ext}`, context)) return `${stem}${ext}`;
    }
  }
  return null;
}

function stripScriptExtension(filePath: string): string {
  return filePath.replace(/\.(d\.ts|ts|tsx|js|jsx|mts|cts|mjs|cjs)$/u, '');
}

function resolveSiblingModule(
  fromFile: string,
  specifier: string,
  byFile: Map<string, SymbolNode[]>,
): string | null {
  const dotted = specifier.replace(/\./gu, '/');
  const base = normalizePosix(joinPosix(dirnamePosix(fromFile), dotted));
  if (byFile.has(base)) return base;
  for (const ext of SOURCE_EXTENSIONS) {
    if (byFile.has(`${base}${ext}`)) return `${base}${ext}`;
    if (byFile.has(`${base}/__init__${ext}`)) return `${base}/__init__${ext}`;
  }
  return null;
}

function dirnamePosix(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx <= 0 ? '.' : filePath.slice(0, idx);
}

function joinPosix(left: string, right: string): string {
  if (left === '.' || left === '') return right;
  return `${left.replace(/\/$/u, '')}/${right.replace(/^\.\//u, '')}`;
}

function normalizePosix(filePath: string): string {
  const parts = filePath.split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join('/');
}
