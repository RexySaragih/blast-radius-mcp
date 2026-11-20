import {
  COCHANGE_DEFAULT_CONFIDENCE,
  COCHANGE_MIN_SUPPORT,
  DEFAULT_MAX_DEPTH,
  HARD_MAX_DEPTH,
  MAX_DIFF_CHARS,
  MAX_IMPACT_NODES,
  MIN_MAX_DEPTH,
} from '../../domain/Limits.js';
import { computeRisk } from '../../domain/Risk.js';
import { isTestFile } from '../../domain/testFiles.js';
import { ApplicationError } from '../errors.js';
import type { PredictForgottenFiles } from '../ports/inbound/PredictForgottenFiles.js';
import type {
  AnalyzeBlastRadius,
  AnalyzeBlastRadiusInput,
  BlastRadiusOutput,
  ImpactRow,
  ModifiedSymbol,
} from '../ports/inbound/AnalyzeBlastRadius.js';
import type { GraphStorePort } from '../ports/outbound/GraphStorePort.js';
import type { ParseResult, SourceParserPort } from '../ports/outbound/SourceParserPort.js';
import type { WorkspacePort } from '../ports/outbound/WorkspacePort.js';
import type { IndexWorkspaceUseCase } from './IndexWorkspace.js';
import { SemanticDiff } from './SemanticDiff.js';
import { TraverseCallers } from './TraverseCallers.js';

export type DiffHunk = {
  oldStart: number;
  newStart: number;
  oldLines: string[];
  newLines: string[];
};

export type FileDiff = {
  path: string;
  hunks: DiffHunk[];
};

export class AnalyzeBlastRadiusUseCase implements AnalyzeBlastRadius {
  private readonly semanticDiff = new SemanticDiff();

  constructor(
    private readonly workspace: WorkspacePort,
    private readonly graph: GraphStorePort,
    private readonly parser: SourceParserPort,
    private readonly indexer: IndexWorkspaceUseCase,
    private readonly traverseCallers: TraverseCallers,
    private readonly predictForgotten: PredictForgottenFiles,
  ) {}

  async execute(input: AnalyzeBlastRadiusInput): Promise<BlastRadiusOutput> {
    if (input.diff.length > MAX_DIFF_CHARS) {
      throw new ApplicationError('DIFF_TOO_LARGE');
    }
    const maxDepth = clampDepth(input.max_depth ?? DEFAULT_MAX_DEPTH);
    const includeTests = input.include_tests ?? true;

    const fileDiffs = parseUnifiedDiff(input.diff);
    this.indexer.execute();

    const modifiedSymbols: ModifiedSymbol[] = [];
    const changedPaths: string[] = [];
    let unresolvedCalls = 0;

    for (const fileDiff of fileDiffs) {
      const relativePath = normalizeRelative(fileDiff.path);
      if (!isInsideRoot(this.workspace, relativePath)) continue;
      changedPaths.push(relativePath);

      const afterSource = this.workspace.exists(relativePath)
        ? this.workspace.readText(relativePath)
        : reconstructNewContent(fileDiff);
      const beforeSource =
        fileDiff.hunks.length > 0
          ? reverseApply(afterSource, fileDiff.hunks)
          : afterSource;

      const before = safeParse(this.parser, relativePath, beforeSource);
      const after = safeParse(this.parser, relativePath, afterSource);
      unresolvedCalls += after.unresolvedRefCount;

      const classified = this.semanticDiff.execute({ before, after });
      for (const change of classified.modifiedSymbols) {
        modifiedSymbols.push({
          name: change.symbol.name,
          file: change.symbol.filePath,
          change: change.kind,
        });
      }
    }

    const impactById = new Map<string, ImpactRow>();
    const testCallerFiles = new Set<string>();

    for (const modified of modifiedSymbols) {
      if (modified.change === 'removed') continue;
      const node =
        this.graph.findByQualifiedName(modified.file, modified.name) ??
        this.graph.findByName(modified.name).find((symbol) => symbol.filePath === modified.file) ??
        null;
      if (!node) continue;

      const traversed = this.traverseCallers.execute({ symbolId: node.id, maxDepth });
      for (const hit of traversed.callers) {
        if (isTestFile(hit.symbol.filePath)) {
          testCallerFiles.add(hit.symbol.filePath);
          if (!includeTests) continue;
        }
        const existing = impactById.get(hit.symbol.id);
        if (existing && existing.depth <= hit.depth) continue;
        impactById.set(hit.symbol.id, {
          name: hit.symbol.name,
          file: hit.symbol.filePath,
          line: hit.symbol.startLine,
          depth: hit.depth,
          kind: hit.symbol.kind,
          is_boundary: hit.symbol.isBoundary,
          route_label: hit.symbol.routeLabel,
        });
      }
    }

    const impactTree = [...impactById.values()].sort(
      (left, right) => left.depth - right.depth || left.file.localeCompare(right.file) || left.name.localeCompare(right.name),
    );
    const productionImpact = impactTree.filter((row) => !isTestFile(row.file));
    const directCallers = productionImpact.filter((row) => row.depth === 1).length;
    const indirectCallers = productionImpact.filter((row) => row.depth > 1).length;
    const affectedRoutes = productionImpact.filter((row) => row.kind === 'route').length;
    const affectedDbModels = productionImpact.filter((row) => row.kind === 'db_column').length;
    const deepestImpactDepth = productionImpact.reduce((max, row) => Math.max(max, row.depth), 0);
    const hasTestGap = testCallerFiles.size === 0 && modifiedSymbols.some((symbol) => symbol.change !== 'removed');
    const risk = computeRisk({
      deepestImpactDepth,
      alteredBoundaryRouteCount: affectedRoutes,
      hasTestGap: modifiedSymbols.length > 0 && hasTestGap,
      hasForgotten: await forgottenChanges(this.predictForgotten, changedPaths),
    });

    const truncated = impactTree.length > MAX_IMPACT_NODES;
    const visible = truncated ? impactTree.slice(0, MAX_IMPACT_NODES) : impactTree;
    const affectedTestFiles = includeTests ? [...testCallerFiles].sort() : [];

    return {
      modified_symbols: modifiedSymbols,
      impact_summary: {
        direct_callers: directCallers,
        indirect_callers: indirectCallers,
        affected_routes: affectedRoutes,
        affected_db_models: affectedDbModels,
        risk_level: risk.risk_level,
        risk_score: risk.risk_score,
      },
      impact_tree: visible,
      affected_test_files: affectedTestFiles,
      unresolved_calls: unresolvedCalls,
      truncated,
      omitted_count: truncated ? impactTree.length - MAX_IMPACT_NODES : 0,
    };
  }
}

async function forgottenChanges(predict: PredictForgottenFiles, paths: string[]): Promise<boolean> {
  try {
    const forgotten = await predict.execute({
      min_confidence: COCHANGE_DEFAULT_CONFIDENCE,
      modified_files: paths,
    });
    return forgotten.unmodified_co_changes.some(
      (row) => row.co_change_frequency >= COCHANGE_DEFAULT_CONFIDENCE && row.support >= COCHANGE_MIN_SUPPORT,
    );
  } catch (error: unknown) {
    if (error instanceof ApplicationError && error.code === 'NOT_A_REPOSITORY') return false;
    throw error;
  }
}

export function parseUnifiedDiff(diff: string): FileDiff[] {
  const files: FileDiff[] = [];
  let current: FileDiff | null = null;

  for (const rawLine of diff.split('\n')) {
    const line = rawLine;
    const gitHeader = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (gitHeader) {
      current = { path: gitHeader[2]!, hunks: [] };
      files.push(current);
      continue;
    }
    const plusPath = line.match(/^\+\+\+ [ab]\/(.+)$/);
    if (plusPath) {
      const path = plusPath[1]!;
      if (!current || current.path !== path) {
        current = { path, hunks: [] };
        files.push(current);
      }
      continue;
    }
    if (line.startsWith('--- ')) continue;
    const hunkHeader = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunkHeader && current) {
      current.hunks.push({
        oldStart: Number(hunkHeader[1]),
        newStart: Number(hunkHeader[3]),
        oldLines: [],
        newLines: [],
      });
      continue;
    }
    if (!current || current.hunks.length === 0) continue;
    const hunk = current.hunks[current.hunks.length - 1]!;
    if (line.startsWith('+')) {
      hunk.newLines.push(line.slice(1));
    } else if (line.startsWith('-')) {
      hunk.oldLines.push(line.slice(1));
    } else if (line.startsWith(' ') || line === '') {
      const text = line.startsWith(' ') ? line.slice(1) : '';
      hunk.oldLines.push(text);
      hunk.newLines.push(text);
    }
  }

  return files;
}

export function reverseApply(afterSource: string, hunks: DiffHunk[]): string {
  const endsWithNewline = afterSource.endsWith('\n');
  const lines = afterSource.split('\n');
  if (endsWithNewline) lines.pop();

  for (const hunk of [...hunks].reverse()) {
    const start = Math.max(0, hunk.newStart - 1);
    lines.splice(start, hunk.newLines.length, ...hunk.oldLines);
  }

  const joined = lines.join('\n');
  return endsWithNewline || afterSource === '' ? `${joined}\n` : joined;
}

function reconstructNewContent(fileDiff: FileDiff): string {
  const lines: string[] = [];
  for (const hunk of fileDiff.hunks) {
    lines.push(...hunk.newLines);
  }
  return `${lines.join('\n')}\n`;
}

function safeParse(parser: SourceParserPort, filePath: string, source: string): ParseResult {
  try {
    return parser.parse(filePath, source);
  } catch {
    return { symbols: [], edges: [], unresolvedRefCount: 0, rawRefs: [], language: 'unknown' };
  }
}

function isInsideRoot(workspace: WorkspacePort, relativePath: string): boolean {
  try {
    workspace.resolveInsideRoot(relativePath);
    return true;
  } catch (error: unknown) {
    if (error instanceof ApplicationError && error.code === 'PATH_ESCAPE') return false;
    throw error;
  }
}

function normalizeRelative(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

function clampDepth(maxDepth: number): number {
  if (!Number.isInteger(maxDepth) || maxDepth < MIN_MAX_DEPTH || maxDepth > HARD_MAX_DEPTH) {
    throw new ApplicationError('INVALID', 'max_depth');
  }
  return maxDepth;
}
