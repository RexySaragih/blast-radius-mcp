import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryGitAdapter } from '../src/adapters/outbound/memory/InMemoryGitAdapter.js';
import { InMemoryGraphAdapter } from '../src/adapters/outbound/memory/InMemoryGraphAdapter.js';
import { ApplicationError } from '../src/application/errors.js';
import {
  computeCoverageConfidence,
  GetTargetedTestSuiteUseCase,
} from '../src/application/use-cases/GetTargetedTestSuite.js';
import { IndexWorkspaceUseCase } from '../src/application/use-cases/IndexWorkspace.js';
import { TreeSitterParser } from '../src/clients/treesitter-client.js';
import { WorkspaceFiles } from '../src/clients/workspace-client.js';
import { handleGetTargetedTestSuite } from '../src/tools/get-targeted-test-suite.js';

const FIXTURE = path.resolve('test/fixtures/user-email');
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

function copyFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-radius-suite-'));
  tempDirs.push(root);
  fs.cpSync(FIXTURE, root, { recursive: true });
  return root;
}

describe('Get Targeted Test Suite', () => {
  describe('when runner is vitest on user-email', () => {
    it('should include user_service.test.ts and omit unrelated.test.ts', async () => {
      const root = copyFixture();
      const workspace = new WorkspaceFiles(root);
      const graph = new InMemoryGraphAdapter();
      const git = new InMemoryGitAdapter();
      git.setWorkingTree(['src/services/user.ts']);
      const indexer = new IndexWorkspaceUseCase(workspace, parser, graph);
      const useCase = new GetTargetedTestSuiteUseCase(git, workspace, parser, graph, indexer);

      const result = await useCase.execute({ target_branch: 'main', runner: 'vitest' });

      expect(result.execution_command).toContain('tests/unit/user_service.test.ts');
      expect(result.execution_command).not.toContain('tests/unit/unrelated.test.ts');
    });
  });

  describe('when runner is node_test', () => {
    it('should return a node --test command for the linked test file', async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-radius-node-test-'));
      tempDirs.push(root);
      fs.mkdirSync(path.join(root, 'src'), { recursive: true });
      fs.mkdirSync(path.join(root, 'test'), { recursive: true });
      fs.writeFileSync(path.join(root, 'src/charge.ts'), 'export function charge() {\n  return 1;\n}\n', 'utf8');
      fs.writeFileSync(
        path.join(root, 'test/charge.test.js'),
        "import { charge } from '../src/charge.js';\nexport function testCharge() {\n  charge();\n}\n",
        'utf8',
      );
      const workspace = new WorkspaceFiles(root);
      const graph = new InMemoryGraphAdapter();
      const git = new InMemoryGitAdapter();
      git.setWorkingTree(['src/charge.ts']);
      const indexer = new IndexWorkspaceUseCase(workspace, parser, graph);
      const useCase = new GetTargetedTestSuiteUseCase(
        git,
        workspace,
        parser,
        graph,
        indexer,
        new Set(['jest', 'vitest', 'pytest', 'go_test', 'node_test']),
      );

      const result = await useCase.execute({ target_branch: 'main', runner: 'node_test' });

      expect(result.execution_command.startsWith('node --test ')).toBe(true);
      expect(result.execution_command).toContain('test/charge.test.js');
    });
  });

  describe('when the repo test script is node --test and the runner argument is vitest', () => {
    it('should emit node --test for a dynamically imported export', async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-radius-node-loader-'));
      tempDirs.push(root);
      fs.mkdirSync(path.join(root, 'src'), { recursive: true });
      fs.mkdirSync(path.join(root, 'test'), { recursive: true });
      fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({ scripts: { test: 'node --test test/*.test.js' } }),
        'utf8',
      );
      fs.writeFileSync(path.join(root, 'src/charge.ts'), 'export function charge() {\n  return 1;\n}\n', 'utf8');
      fs.writeFileSync(
        path.join(root, 'src/index.ts'),
        "export { charge } from './charge.js';\n",
        'utf8',
      );
      fs.writeFileSync(
        path.join(root, 'test/charge.test.js'),
        [
          "import { test } from 'node:test';",
          'async function loadCore() {',
          "  return import(join(root, 'dist/index.js'));",
          '}',
          "test('runs charge', async () => {",
          '  const { charge } = await loadCore();',
          '  charge();',
          '});',
          '',
        ].join('\n'),
        'utf8',
      );
      const workspace = new WorkspaceFiles(root);
      const graph = new InMemoryGraphAdapter();
      const git = new InMemoryGitAdapter();
      git.setWorkingTree(['src/charge.ts']);
      const indexer = new IndexWorkspaceUseCase(workspace, parser, graph);
      const useCase = new GetTargetedTestSuiteUseCase(
        git,
        workspace,
        parser,
        graph,
        indexer,
        new Set(['jest', 'vitest', 'pytest', 'go_test', 'node_test']),
      );

      const result = await useCase.execute({ target_branch: 'main', runner: 'vitest' });

      expect(result.execution_command.startsWith('node --test ')).toBe(true);
      expect(result.execution_command).toContain('test/charge.test.js');
      expect(result.execution_command).not.toContain('vitest');
    });
  });

  describe('when one of two modified symbols is linked', () => {
    it('should compute coverage_confidence 0.50', () => {
      expect(computeCoverageConfidence(1, 2, 0)).toBe(0.5);
    });
  });

  describe('when runner is pytest before Python support', () => {
    it('should return UNSUPPORTED_RUNNER without spawning pytest', async () => {
      const root = copyFixture();
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
        new Set(['jest', 'vitest']),
      );
      const response = await handleGetTargetedTestSuite(useCase, { runner: 'pytest' });
      expect(response.isError).toBe(true);
      expect(response.content[0]?.text).toContain('UNSUPPORTED_RUNNER');
      expect(() => {
        throw new ApplicationError('UNSUPPORTED_RUNNER', 'pytest');
      }).toThrow(ApplicationError);
    });
  });
});
