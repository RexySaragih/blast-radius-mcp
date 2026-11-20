import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryGraphAdapter } from '../src/adapters/outbound/memory/InMemoryGraphAdapter.js';
import { IndexWorkspaceUseCase } from '../src/application/use-cases/IndexWorkspace.js';
import { TreeSitterParser } from '../src/clients/treesitter-client.js';
import { WorkspaceFiles } from '../src/clients/workspace-client.js';

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

function write(root: string, relativePath: string, contents: string): void {
  const abs = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents, 'utf8');
}

describe('Package imports', () => {
  describe('when a package barrel re-exports a function', () => {
    it('should keep a caller edge to the real function', async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-radius-pkg-'));
      tempDirs.push(root);
      write(
        root,
        'packages/core/package.json',
        JSON.stringify({
          name: '@acme/core',
          exports: { '.': { import: './dist/index.js' } },
        }),
      );
      write(
        root,
        'packages/core/src/search/impact.ts',
        'export function impactForSymbol() {\n  return 1;\n}\n',
      );
      write(
        root,
        'packages/core/src/index.ts',
        "export { impactForSymbol } from './search/impact.js';\n",
      );
      write(
        root,
        'packages/app/src/caller.ts',
        "import { impactForSymbol } from '@acme/core';\nexport function run() {\n  impactForSymbol();\n}\n",
      );
      const graph = new InMemoryGraphAdapter();
      new IndexWorkspaceUseCase(new WorkspaceFiles(root), parser, graph).execute();
      const run = graph.listSymbols().find((symbol) => symbol.name === 'run');
      const target = graph.listSymbols().find((symbol) => symbol.name === 'impactForSymbol');
      const calls = graph
        .listEdges()
        .find((item) => item.type === 'calls' && item.sourceId === run?.id && item.targetId === target?.id);

      expect(run).toBeTruthy();
      expect(target?.filePath).toBe('packages/core/src/search/impact.ts');
      expect(calls).toBeTruthy();
    });
  });
});
