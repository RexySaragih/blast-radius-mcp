import type { SymbolNode } from '../../domain/Symbol.js';
import type { GitPort } from '../ports/outbound/GitPort.js';
import type { GraphStorePort } from '../ports/outbound/GraphStorePort.js';
import type { ParseResult, SourceParserPort } from '../ports/outbound/SourceParserPort.js';
import type { WorkspacePort } from '../ports/outbound/WorkspacePort.js';
import { LinkSymbols } from './LinkSymbols.js';
import { readPackageEntries } from './packageEntries.js';
import { SemanticDiff } from './SemanticDiff.js';

export type SemanticChangeSet = {
  symbols: SymbolNode[];
  unresolvedRefCount: number;
};

export async function collectSemanticChanges(input: {
  git: GitPort;
  workspace: WorkspacePort;
  parser: SourceParserPort;
  graph: GraphStorePort;
  targetBranch: string;
  paths: string[];
}): Promise<SemanticChangeSet> {
  const semanticDiff = new SemanticDiff();
  const linker = new LinkSymbols();
  const packageEntries = readPackageEntries(input.workspace);
  const symbols: SymbolNode[] = [];
  const seen = new Set<string>();
  let unresolvedRefCount = 0;

  for (const filePath of input.paths) {
    const relative = normalize(filePath);
    if (!insideRoot(input.workspace, relative) || !input.workspace.exists(relative)) continue;
    const afterSource = input.workspace.readText(relative);
    const beforeSource = await input.git.showFile(input.targetBranch, relative);
    const after = input.parser.parse(relative, afterSource);
    unresolvedRefCount += unresolvedCount(linker, after, input.graph, relative, packageEntries);
    const changes =
      beforeSource === null
        ? after.symbols
        : semanticDiff
            .execute({ before: input.parser.parse(relative, beforeSource), after })
            .modifiedSymbols.filter((change) => change.kind !== 'removed')
            .map((change) => change.symbol);
    for (const parsed of changes) {
      const stored = input.graph.getNode(parsed.id) ?? parsed;
      if (stored.kind === 'test' || seen.has(stored.id)) continue;
      seen.add(stored.id);
      symbols.push(stored);
    }
  }

  return { symbols, unresolvedRefCount };
}

function unresolvedCount(
  linker: LinkSymbols,
  parse: ParseResult,
  graph: GraphStorePort,
  filePath: string,
  packageEntries: Map<string, string>,
): number {
  const linked = linker.execute({
    parses: [parse],
    externalSymbols: graph.listSymbols().filter((symbol) => symbol.filePath !== filePath),
    packageEntries,
  });
  return linked.parses[0]?.unresolvedRefCount ?? parse.unresolvedRefCount;
}

function insideRoot(workspace: WorkspacePort, relativePath: string): boolean {
  try {
    workspace.resolveInsideRoot(relativePath);
    return true;
  } catch {
    return false;
  }
}

function normalize(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}
