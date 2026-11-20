import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryGitAdapter } from '../src/adapters/outbound/memory/InMemoryGitAdapter.js';
import { InMemoryGraphAdapter } from '../src/adapters/outbound/memory/InMemoryGraphAdapter.js';
import { GetTargetedTestSuiteUseCase } from '../src/application/use-cases/GetTargetedTestSuite.js';
import { IndexWorkspaceUseCase } from '../src/application/use-cases/IndexWorkspace.js';
import { TreeSitterParser } from '../src/clients/treesitter-client.js';
import { WorkspaceFiles } from '../src/clients/workspace-client.js';
import { handleGetTargetedTestSuite } from '../src/tools/get-targeted-test-suite.js';

const FIXTURE = path.resolve('test/fixtures/py-charge');
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

describe('Python Extract', () => {
  describe('when indexing py-charge', () => {
    it('should index a function symbol named charge', async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-radius-py-'));
      tempDirs.push(root);
      fs.cpSync(FIXTURE, root, { recursive: true });
      const workspace = new WorkspaceFiles(root);
      const graph = new InMemoryGraphAdapter();
      new IndexWorkspaceUseCase(workspace, parser, graph).execute();
      expect(graph.listSymbols().some((symbol) => symbol.name === 'charge')).toBe(true);
    });
  });

  describe('when runner is pytest', () => {
    it('should return a pytest command containing test_charge.py', async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-radius-py-suite-'));
      tempDirs.push(root);
      fs.cpSync(FIXTURE, root, { recursive: true });
      const workspace = new WorkspaceFiles(root);
      const graph = new InMemoryGraphAdapter();
      const git = new InMemoryGitAdapter();
      git.setWorkingTree(['charge.py']);
      const indexer = new IndexWorkspaceUseCase(workspace, parser, graph);
      const useCase = new GetTargetedTestSuiteUseCase(
        git,
        workspace,
        parser,
        graph,
        indexer,
        new Set(['jest', 'vitest', 'pytest']),
      );
      indexer.execute();
      const result = await useCase.execute({ target_branch: 'main', runner: 'pytest' });
      expect(result.execution_command).toContain('pytest');
      expect(result.execution_command).toContain('test_charge.py');
    });
  });

  describe('when go_test is still unsupported in this ticket scope', () => {
    it('should still reject go_test while pytest works', async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-radius-py-go-'));
      tempDirs.push(root);
      fs.cpSync(FIXTURE, root, { recursive: true });
      const workspace = new WorkspaceFiles(root);
      const graph = new InMemoryGraphAdapter();
      const git = new InMemoryGitAdapter();
      const indexer = new IndexWorkspaceUseCase(workspace, parser, graph);
      const useCase = new GetTargetedTestSuiteUseCase(
        git,
        workspace,
        parser,
        graph,
        indexer,
        new Set(['jest', 'vitest', 'pytest']),
      );
      const response = await handleGetTargetedTestSuite(useCase, { runner: 'go_test' });
      expect(response.content[0]?.text).toContain('UNSUPPORTED_RUNNER');
    });
  });
});
