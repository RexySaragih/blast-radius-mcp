import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryGraphAdapter } from '../src/adapters/outbound/memory/InMemoryGraphAdapter.js';
import { IndexWorkspaceUseCase } from '../src/application/use-cases/IndexWorkspace.js';
import { TreeSitterParser } from '../src/clients/treesitter-client.js';
import { WorkspaceFiles } from '../src/clients/workspace-client.js';

const FIXTURE = path.resolve('test/fixtures/java-health');
const tempDirs: string[] = [];
let parser: TreeSitterParser;

beforeAll(async () => {
  parser = await TreeSitterParser.create();
});

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('Java Extract', () => {
  describe('when indexing java-health', () => {
    it('should mark @GetMapping("/health") as a boundary route', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-radius-java-'));
      tempDirs.push(root);
      fs.cpSync(FIXTURE, root, { recursive: true });
      const workspace = new WorkspaceFiles(root);
      const graph = new InMemoryGraphAdapter();
      new IndexWorkspaceUseCase(workspace, parser, graph).execute();
      const health = graph
        .listSymbols()
        .find((symbol) => symbol.name === 'health' || symbol.name.endsWith('.health'));
      expect(health?.kind).toBe('route');
      expect(health?.isBoundary).toBe(true);
    });
  });

  describe('when a private helper has no mapping', () => {
    it('should not mark helper as a boundary route', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-radius-java-helper-'));
      tempDirs.push(root);
      fs.cpSync(FIXTURE, root, { recursive: true });
      const workspace = new WorkspaceFiles(root);
      const graph = new InMemoryGraphAdapter();
      new IndexWorkspaceUseCase(workspace, parser, graph).execute();
      const helper = graph
        .listSymbols()
        .find((symbol) => symbol.name === 'helper' || symbol.name.endsWith('.helper'));
      expect(helper?.kind === 'route' && helper.isBoundary).toBeFalsy();
    });
  });

  describe('when the Java wasm cannot be loaded', () => {
    it('should fail with a missing grammar message instead of empty success', async () => {
      const broken = Object.create(parser) as TreeSitterParser;
      Object.defineProperty(broken, 'languages', { value: { ...((parser as unknown as { languages: object }).languages), java: undefined } });
      Object.defineProperty(broken, 'loadErrors', {
        value: new Map([['java', 'missing grammar tree-sitter-java.wasm']]),
      });
      expect(() => broken.parse('HealthController.java', 'class X {}')).toThrow(/missing grammar/i);
    });
  });
});
