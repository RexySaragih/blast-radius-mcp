import { HARD_MAX_DEPTH, MIN_MAX_DEPTH } from '../../domain/Limits.js';
import type { SymbolNode } from '../../domain/Symbol.js';
import { ApplicationError } from '../errors.js';
import type { GraphStorePort } from '../ports/outbound/GraphStorePort.js';

export type CallerHit = {
  symbol: SymbolNode;
  depth: number;
};

export type TraverseCallersInput = {
  symbolId: string;
  maxDepth: number;
};

export type TraverseCallersOutput = {
  root: SymbolNode;
  callers: CallerHit[];
};

export class TraverseCallers {
  constructor(private readonly graph: GraphStorePort) {}

  execute(input: TraverseCallersInput): TraverseCallersOutput {
    const maxDepth = this.clampDepth(input.maxDepth);
    const root = this.graph.getNode(input.symbolId);
    if (!root) {
      throw new ApplicationError('SYMBOL_NOT_FOUND', input.symbolId);
    }

    const callers: CallerHit[] = [];
    const visited = new Set<string>([root.id]);
    const queue: Array<{ id: string; depth: number }> = [{ id: root.id, depth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;
      if (current.depth >= maxDepth) continue;

      const incoming = this.graph.getIncomingEdges(current.id);
      for (const edge of incoming) {
        if (visited.has(edge.sourceId)) continue;
        const caller = this.graph.getNode(edge.sourceId);
        if (!caller) continue;
        visited.add(caller.id);
        const depth = current.depth + 1;
        callers.push({ symbol: caller, depth });
        if (caller.isBoundary) continue;
        queue.push({ id: caller.id, depth });
      }
    }

    return { root, callers };
  }

  private clampDepth(maxDepth: number): number {
    if (!Number.isInteger(maxDepth) || maxDepth < MIN_MAX_DEPTH) {
      throw new ApplicationError('INVALID', 'max_depth');
    }
    return Math.min(maxDepth, HARD_MAX_DEPTH);
  }
}
