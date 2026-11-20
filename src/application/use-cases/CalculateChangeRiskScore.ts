import { DEFAULT_MAX_DEPTH } from '../../domain/Limits.js';
import { computeRisk } from '../../domain/Risk.js';
import type {
  CalculateChangeRiskScore,
  CalculateChangeRiskScoreInput,
  RiskScoreOutput,
} from '../ports/inbound/CalculateChangeRiskScore.js';
import type { GitPort } from '../ports/outbound/GitPort.js';
import { resolveTargetBranch } from './resolveTargetBranch.js';
import type { GraphStorePort } from '../ports/outbound/GraphStorePort.js';
import type { SourceParserPort } from '../ports/outbound/SourceParserPort.js';
import type { WorkspacePort } from '../ports/outbound/WorkspacePort.js';
import type { IndexWorkspaceUseCase } from './IndexWorkspace.js';
import type { PredictForgottenFiles } from '../ports/inbound/PredictForgottenFiles.js';
import { TraverseCallers } from './TraverseCallers.js';
import { collectSemanticChanges } from './SemanticChanges.js';
import { COCHANGE_DEFAULT_CONFIDENCE, COCHANGE_MIN_SUPPORT } from '../../domain/Limits.js';
import { isTestFile } from '../../domain/testFiles.js';

export class CalculateChangeRiskScoreUseCase implements CalculateChangeRiskScore {
  constructor(
    private readonly git: GitPort,
    private readonly workspace: WorkspacePort,
    private readonly parser: SourceParserPort,
    private readonly graph: GraphStorePort,
    private readonly indexer: IndexWorkspaceUseCase,
    private readonly traverseCallers: TraverseCallers,
    private readonly predictForgotten: PredictForgottenFiles,
  ) {}

  async execute(input: CalculateChangeRiskScoreInput): Promise<RiskScoreOutput> {
    await this.git.ensureRepo();
    this.indexer.execute();
    const targetBranch = await resolveTargetBranch(this.git, input.target_branch);
    const changed = await this.git.changedFiles(targetBranch);
    const { symbols: modified } = await collectSemanticChanges({
      git: this.git,
      workspace: this.workspace,
      parser: this.parser,
      graph: this.graph,
      targetBranch,
      paths: changed,
    });

    let deepest = 0;
    let hasTestGap = false;
    const routeIds = new Set<string>();

    for (const symbol of modified) {
      if (symbol.kind === 'route' && symbol.isBoundary) routeIds.add(symbol.id);
      const impact = this.traverseCallers.execute({
        symbolId: symbol.id,
        maxDepth: DEFAULT_MAX_DEPTH,
      });
      for (const hit of impact.callers) {
        deepest = Math.max(deepest, hit.depth);
        if (hit.symbol.kind === 'route' && hit.symbol.isBoundary) routeIds.add(hit.symbol.id);
      }
      const linkedTest = this.graph.getIncomingEdges(symbol.id).some((edge) => {
        const caller = this.graph.getNode(edge.sourceId);
        return caller != null && (caller.kind === 'test' || isTestFile(caller.filePath));
      });
      if (!linkedTest) hasTestGap = true;
    }

    const alteredRoutes = routeIds.size;

    const forgotten = await this.predictForgotten.execute({
      min_confidence: COCHANGE_DEFAULT_CONFIDENCE,
      modified_files: changed,
    });
    const hasForgotten = forgotten.unmodified_co_changes.some(
      (row) => row.co_change_frequency >= COCHANGE_DEFAULT_CONFIDENCE && row.support >= COCHANGE_MIN_SUPPORT,
    );

    const risk = computeRisk({
      deepestImpactDepth: deepest,
      alteredBoundaryRouteCount: alteredRoutes,
      hasTestGap: modified.length > 0 && hasTestGap,
      hasForgotten,
    });

    return {
      risk_score: risk.risk_score,
      risk_level: risk.risk_level,
      depth_points: risk.depth_points,
      api_points: risk.api_points,
      test_gap_points: risk.test_gap_points,
      forgotten_points: risk.forgotten_points,
    };
  }
}

/** Pure helper for AC2/AC3 unit-style scoring without git. */
export function scoreFromFactors(input: {
  deepestImpactDepth: number;
  alteredBoundaryRouteCount: number;
  hasTestGap: boolean;
  hasForgotten: boolean;
}): RiskScoreOutput {
  const risk = computeRisk(input);
  return {
    risk_score: risk.risk_score,
    risk_level: risk.risk_level,
    depth_points: risk.depth_points,
    api_points: risk.api_points,
    test_gap_points: risk.test_gap_points,
    forgotten_points: risk.forgotten_points,
  };
}

