import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApplicationError } from '../src/application/errors.js';
import { IndexWorkspaceUseCase } from '../src/application/use-cases/IndexWorkspace.js';
import { InMemoryGraphAdapter } from '../src/adapters/outbound/memory/InMemoryGraphAdapter.js';
import { InMemoryWorkspaceAdapter } from '../src/adapters/outbound/memory/InMemoryWorkspaceAdapter.js';
import { TreeSitterParser } from '../src/clients/treesitter-client.js';
import { createDebouncedPathFlush, WorkspaceFiles } from '../src/clients/workspace-client.js';
import { MAX_FILE_BYTES, REINDEX_BUDGET_MS } from '../src/domain/Limits.js';

let parser: TreeSitterParser;

beforeAll(async () => {
  parser = await TreeSitterParser.create();
});

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-radius-index-'));
  tempDirs.push(root);
  return root;
}

describe('Index Workspace', () => {
  describe('when the reindex budget is already spent', () => {
    it('should index nothing', () => {
      const workspace = new InMemoryWorkspaceAdapter('/repo');
      workspace.seed({
        'src/ok.ts': 'export function ok() { return 1; }\n',
      });
      const graph = new InMemoryGraphAdapter();
      const result = new IndexWorkspaceUseCase(workspace, parser, graph).execute(undefined, 0);

      expect(result.indexedFiles).toBe(0);
      expect(graph.listSymbols()).toHaveLength(0);
    });
  });

  describe('when node_modules and oversized sources are present', () => {
    it('should omit both from file_index', () => {
      const workspace = new InMemoryWorkspaceAdapter('/repo');
      workspace.seed({
        'src/ok.ts': 'export function ok() { return 1; }\n',
        'node_modules/pkg/index.ts': 'export function ignored() { return 0; }\n',
        'src/huge.ts': 'x'.repeat(MAX_FILE_BYTES + 1),
      });
      const graph = new InMemoryGraphAdapter();
      const indexer = new IndexWorkspaceUseCase(workspace, parser, graph);

      indexer.execute();
      const indexed = graph.listIndexedFiles().map((row) => row.filePath);

      expect(indexed).toContain('src/ok.ts');
      expect(indexed).not.toContain('node_modules/pkg/index.ts');
      expect(indexed).not.toContain('src/huge.ts');
    });
  });

  describe('when a 500-line TypeScript file body changes', () => {
    it('should store the new hash under the reindex budget', () => {
      const lines = Array.from({ length: 500 }, (_, index) => `  const v${index} = ${index};`);
      const original = ['export function big() {', ...lines, '  return v0;', '}', ''].join('\n');
      const updated = ['export function big() {', ...lines, '  return v1;', '}', ''].join('\n');

      const workspace = new InMemoryWorkspaceAdapter('/repo');
      workspace.seed({ 'src/big.ts': original });
      const graph = new InMemoryGraphAdapter();
      const indexer = new IndexWorkspaceUseCase(workspace, parser, graph);

      indexer.execute();
      const firstHash = graph.fileContentHash('src/big.ts');
      workspace.writeText('src/big.ts', updated);

      const result = indexer.reindexFile('src/big.ts');
      const secondHash = graph.fileContentHash('src/big.ts');

      expect(firstHash).toBeTruthy();
      expect(secondHash).not.toBe(firstHash);
      expect(result.durationMs).toBeLessThan(REINDEX_BUDGET_MS);
    });
  });

  describe('when only the callee file changes', () => {
    it('should keep the caller edge', () => {
      const workspace = new InMemoryWorkspaceAdapter('/repo');
      workspace.seed({
        'src/callee.ts': 'export function target() { return 1; }\n',
        'src/caller.ts': "import { target } from './callee.js';\nexport function caller() { return target(); }\n",
      });
      const graph = new InMemoryGraphAdapter();
      const indexer = new IndexWorkspaceUseCase(workspace, parser, graph);
      indexer.execute();

      const before = graph.listSymbols().find((symbol) => symbol.name === 'target');
      expect(before).toBeDefined();
      expect(
        graph.listEdges().some((edge) => edge.type === 'calls' && edge.targetId === before?.id),
      ).toBe(true);

      workspace.writeText('src/callee.ts', 'export function target() { return 2; }\n');
      indexer.execute(['src/callee.ts']);

      const after = graph.listSymbols().find((symbol) => symbol.name === 'target');
      const caller = graph.listSymbols().find((symbol) => symbol.name === 'caller');
      expect(after).toBeDefined();
      expect(caller).toBeDefined();
      expect(
        graph.listEdges().some(
          (edge) => edge.type === 'calls' && edge.sourceId === caller?.id && edge.targetId === after?.id,
        ),
      ).toBe(true);
    });
  });

  describe('when two paths arrive in one debounce window', () => {
    it('should flush them together', () => {
      vi.useFakeTimers();
      const flushed: string[][] = [];
      const batch = createDebouncedPathFlush(200, (paths) => flushed.push(paths));
      batch.push('src/a.ts');
      batch.push('src/b.ts');
      vi.advanceTimersByTime(200);
      expect(flushed).toEqual([['src/a.ts', 'src/b.ts']]);
      vi.useRealTimers();
    });
  });

  describe('when a path realpath-resolves outside the root', () => {
    it('should throw PATH_ESCAPE', () => {
      const root = tempRepo();
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-radius-outside-'));
      tempDirs.push(outside);
      const linkPath = path.join(root, 'escape-link');
      fs.symlinkSync(outside, linkPath);

      const workspace = new WorkspaceFiles(root);
      expect(() => workspace.resolveInsideRoot('escape-link')).toThrow(ApplicationError);
      try {
        workspace.resolveInsideRoot('escape-link');
      } catch (error) {
        expect(error).toBeInstanceOf(ApplicationError);
        expect((error as ApplicationError).code).toBe('PATH_ESCAPE');
      }
    });
  });
});
