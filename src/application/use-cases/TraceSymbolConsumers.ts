import { DEFAULT_MAX_DEPTH, HARD_MAX_DEPTH, MAX_IMPACT_NODES, MIN_MAX_DEPTH } from '../../domain/Limits.js';
import { ApplicationError } from '../errors.js';
import type {
  CallerHit,
  TraceConsumersInput,
  TraceConsumersOutput,
  TraceSymbolConsumers,
} from '../ports/inbound/TraceSymbolConsumers.js';
import type { GraphStorePort } from '../ports/outbound/GraphStorePort.js';
import type { WorkspacePort } from '../ports/outbound/WorkspacePort.js';
import type { IndexWorkspaceUseCase } from './IndexWorkspace.js';
import { TraverseCallers } from './TraverseCallers.js';

export class TraceSymbolConsumersUseCase implements TraceSymbolConsumers {
  constructor(
    private readonly workspace: WorkspacePort,
    private readonly graph: GraphStorePort,
    private readonly indexer: IndexWorkspaceUseCase,
    private readonly traverseCallers: TraverseCallers,
  ) {}

  async execute(input: TraceConsumersInput): Promise<TraceConsumersOutput> {
    const maxDepth = clampDepth(input.max_depth ?? DEFAULT_MAX_DEPTH);
    this.workspace.resolveInsideRoot(input.source_file);
    this.indexer.execute();

    const node =
      this.graph.findByQualifiedName(input.source_file, input.symbol_name) ??
      this.graph.findByName(input.symbol_name).find((symbol) => symbol.filePath === input.source_file) ??
      null;
    if (!node) {
      throw new ApplicationError('SYMBOL_NOT_FOUND', input.symbol_name);
    }

    const traversed = this.traverseCallers.execute({ symbolId: node.id, maxDepth });
    const callers: CallerHit[] = traversed.callers.map((hit) => ({
      name: hit.symbol.name,
      file: hit.symbol.filePath,
      line: hit.symbol.startLine,
      depth: hit.depth,
      route: hit.symbol.routeLabel ?? (hit.symbol.kind === 'route' ? hit.symbol.name : ''),
    }));
    const truncated = callers.length > MAX_IMPACT_NODES;
    const visible = truncated ? callers.slice(0, MAX_IMPACT_NODES) : callers;
    const routes = visible.filter((hit) => hit.route).map((hit) => hit.route);
    const eventHandlers = traversed.callers
      .filter((hit) => hit.symbol.kind === 'event_handler')
      .map((hit) => hit.symbol.name);

    return {
      symbol: `${node.name} ${node.filePath}`,
      callers: visible,
      routes: [...new Set(routes)],
      event_handlers: [...new Set(eventHandlers)],
      truncated,
      omitted_count: truncated ? callers.length - MAX_IMPACT_NODES : 0,
    };
  }
}

function clampDepth(maxDepth: number): number {
  if (!Number.isInteger(maxDepth) || maxDepth < MIN_MAX_DEPTH || maxDepth > HARD_MAX_DEPTH) {
    throw new ApplicationError('INVALID', 'max_depth');
  }
  return maxDepth;
}
