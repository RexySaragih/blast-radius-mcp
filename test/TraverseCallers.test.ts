import { describe, expect, it } from 'vitest';
import { BlastRadiusTestDriver } from '../src/adapters/inbound/test/BlastRadiusTestDriver.js';
import { InMemoryGraphAdapter } from '../src/adapters/outbound/memory/InMemoryGraphAdapter.js';
import { TraverseCallers } from '../src/application/use-cases/TraverseCallers.js';
import { createEdge } from '../src/domain/Edge.js';
import { createSymbol, type SymbolKind, type SymbolNode } from '../src/domain/Symbol.js';

function symbol(name: string, kind: SymbolKind = 'function', isBoundary = false): SymbolNode {
  return createSymbol({
    name,
    kind,
    filePath: `${name}.ts`,
    startLine: 1,
    startColumn: 1,
    endLine: 10,
    endColumn: 1,
    hash: name,
    signatureHash: name,
    bodyHash: name,
    isBoundary,
    language: 'typescript',
  });
}

function driverWith(nodes: SymbolNode[], calls: Array<[SymbolNode, SymbolNode]>): BlastRadiusTestDriver {
  const graph = new InMemoryGraphAdapter();
  graph.seed(
    nodes,
    calls.map(([from, to]) => createEdge(from.id, 'calls', to.id)),
  );
  return new BlastRadiusTestDriver({ traverseCallers: new TraverseCallers(graph) });
}

describe('Traverse callers', () => {
  describe('when max_depth is 1 on a two-hop graph', () => {
    it('should return only the depth-1 caller', () => {
      const a = symbol('A');
      const b = symbol('B');
      const c = symbol('C');
      const driver = driverWith([a, b, c], [
        [b, a],
        [c, b],
      ]);

      const result = driver.traverseCallers({ symbolId: a.id, maxDepth: 1 });

      expect(result.callers.map((hit) => hit.symbol.name)).toEqual(['B']);
      expect(result.callers.every((hit) => hit.depth === 1)).toBe(true);
    });
  });

  describe('when callers form a two-node cycle', () => {
    it('should list each symbol id once and return', () => {
      const a = symbol('A');
      const b = symbol('B');
      const driver = driverWith([a, b], [
        [b, a],
        [a, b],
      ]);

      const result = driver.traverseCallers({ symbolId: a.id, maxDepth: 10 });
      const ids = result.callers.map((hit) => hit.symbol.id);

      expect(ids).toEqual([b.id]);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('when a boundary route sits between a service and AboveRoute', () => {
    it('should include the route, exclude AboveRoute, and hide depth-0 roots', () => {
      const service = symbol('AuthService');
      const route = symbol('loginHandler', 'route', true);
      const above = symbol('AboveRoute');
      const driver = driverWith([service, route, above], [
        [route, service],
        [above, route],
      ]);

      const result = driver.traverseCallers({ symbolId: service.id, maxDepth: 10 });
      const names = result.callers.map((hit) => hit.symbol.name);

      expect(names).toContain('loginHandler');
      expect(names).not.toContain('AboveRoute');
      expect(names).not.toContain('AuthService');
      expect(result.callers.every((hit) => hit.depth > 0)).toBe(true);
    });
  });
});
