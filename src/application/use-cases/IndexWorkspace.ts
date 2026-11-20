import { createHash } from 'node:crypto';
import { REINDEX_BUDGET_MS } from '../../domain/Limits.js';
import { isTestFile } from '../../domain/testFiles.js';
import type { GraphStorePort } from '../ports/outbound/GraphStorePort.js';
import type { ParseResult, SourceParserPort } from '../ports/outbound/SourceParserPort.js';
import type { WorkspacePort } from '../ports/outbound/WorkspacePort.js';
import { LinkSymbols } from './LinkSymbols.js';
import { readPackageEntries } from './packageEntries.js';
import { TagBoundaries } from './TagBoundaries.js';


export type IndexWorkspaceResult = {
  indexedFiles: number;
  durationMs: number;
};

type PendingParse = {
  relativePath: string;
  parse: ParseResult;
};

export class IndexWorkspaceUseCase {
  private readonly linker = new LinkSymbols();
  private readonly tagger = new TagBoundaries();

  constructor(
    private readonly workspace: WorkspacePort,
    private readonly parser: SourceParserPort,
    private readonly graph: GraphStorePort,
  ) {}

  execute(paths?: string[], budgetMs = REINDEX_BUDGET_MS): IndexWorkspaceResult {
    const started = Date.now();
    const targets = paths ?? this.workspace.listSourceFiles();
    const dirty = dirtyPaths(this.graph, this.workspace, targets);
    const packageEntries = readPackageEntries(this.workspace);
    const batch = uniquePaths([
      ...dirty,
      ...relatedFiles(this.graph, dirty),
      ...(dirty.length > 0 ? [...packageEntries.values()] : []),
    ]);
    const pending: PendingParse[] = [];
    const sources = new Map<string, string>();

    for (const relativePath of batch) {
      if (Date.now() - started >= budgetMs) break;
      try {
        const source = this.workspace.readText(relativePath);
        const parse = this.parser.parse(relativePath, source);
        pending.push({ relativePath, parse });
        sources.set(relativePath, source);
        this.graph.setFileHash(relativePath, sha256(source));
      } catch {
        // skip unreadable or unsupported files
      }
    }

    if (pending.length > 0) {
      const batchFiles = new Set(pending.map((item) => item.relativePath));
      const externalSymbols = this.graph
        .listSymbols()
        .filter((symbol) => !batchFiles.has(symbol.filePath));
      const linked = this.linker.execute({
        parses: pending.map((item) => item.parse),
        externalSymbols,
        packageEntries,
      });
      for (let i = 0; i < pending.length; i += 1) {
        const item = pending[i]!;
        const parse = linked.parses[i] ?? item.parse;
        const tagged = this.tagger.execute({
          filePath: item.relativePath,
          source: sources.get(item.relativePath) ?? '',
          symbols: parse.symbols,
          edges: parse.edges,
        });
        const symbols = isTestFile(item.relativePath)
          ? tagged.symbols.map((symbol) =>
              symbol.kind === 'route' || symbol.kind === 'event_handler' || symbol.kind === 'db_column'
                ? symbol
                : { ...symbol, kind: 'test' as const },
            )
          : tagged.symbols;
        this.graph.replaceFile(item.relativePath, symbols, tagged.edges);
      }
    }

    return {
      indexedFiles: this.graph.listIndexedFiles().length,
      durationMs: Date.now() - started,
    };
  }

  reindexFile(relativePath: string): IndexWorkspaceResult {
    return this.execute([relativePath]);
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function dirtyPaths(graph: GraphStorePort, workspace: WorkspacePort, targets: string[]): string[] {
  const dirty: string[] = [];
  for (const relativePath of targets) {
    try {
      const source = workspace.readText(relativePath);
      if (graph.fileContentHash(relativePath) === sha256(source)) continue;
      dirty.push(relativePath);
    } catch {
      // unreadable files are not part of the batch
    }
  }
  return dirty;
}

function relatedFiles(graph: GraphStorePort, dirty: string[]): string[] {
  const dirtySet = new Set(dirty);
  const dirtyIds = new Set(
    graph
      .listSymbols()
      .filter((symbol) => dirtySet.has(symbol.filePath))
      .map((symbol) => symbol.id),
  );
  const related = new Set<string>();
  for (const edge of graph.listEdges()) {
    const sourceDirty = dirtyIds.has(edge.sourceId);
    const targetDirty = dirtyIds.has(edge.targetId);
    if (sourceDirty === targetDirty) continue;
    const otherId = sourceDirty ? edge.targetId : edge.sourceId;
    const other = graph.getNode(otherId);
    if (other && !dirtySet.has(other.filePath)) related.add(other.filePath);
  }
  return [...related];
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)];
}
