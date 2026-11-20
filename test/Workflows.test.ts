import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryGitAdapter } from '../src/adapters/outbound/memory/InMemoryGitAdapter.js';
import { InMemoryGraphAdapter } from '../src/adapters/outbound/memory/InMemoryGraphAdapter.js';
import { GetTargetedTestSuiteUseCase } from '../src/application/use-cases/GetTargetedTestSuite.js';
import { IndexWorkspaceUseCase } from '../src/application/use-cases/IndexWorkspace.js';
import { TraceSymbolConsumersUseCase } from '../src/application/use-cases/TraceSymbolConsumers.js';
import { TraverseCallers } from '../src/application/use-cases/TraverseCallers.js';
import { scoreFromFactors } from '../src/application/use-cases/CalculateChangeRiskScore.js';
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

function copy(name: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `blast-radius-wf-${name}-`));
  tempDirs.push(root);
  fs.cpSync(path.resolve(`test/fixtures/${name}`), root, { recursive: true });
  return root;
}

describe('Workflow fixtures', () => {
  describe('workflow A trace', () => {
    it('should meet SC-001 on refactor-auth', async () => {
      const root = copy('refactor-auth');
      const workspace = new WorkspaceFiles(root);
      const graph = new InMemoryGraphAdapter();
      const indexer = new IndexWorkspaceUseCase(workspace, parser, graph);
      const traverse = new TraverseCallers(graph);
      const trace = new TraceSymbolConsumersUseCase(workspace, graph, indexer, traverse);
      const result = await trace.execute({
        symbol_name: 'AuthService.validateSession',
        source_file: 'src/auth/AuthService.ts',
        max_depth: 3,
      });
      expect(result.callers).toHaveLength(3);
      expect(result.routes).toHaveLength(1);
      expect(result.event_handlers).toHaveLength(1);
    });
  });

  describe('workflow B targeted vitest', () => {
    it('should include the linked user_service test file', async () => {
      const root = copy('user-email');
      const workspace = new WorkspaceFiles(root);
      const graph = new InMemoryGraphAdapter();
      const git = new InMemoryGitAdapter();
      git.setWorkingTree(['src/services/user.ts']);
      const indexer = new IndexWorkspaceUseCase(workspace, parser, graph);
      const suite = new GetTargetedTestSuiteUseCase(git, workspace, parser, graph, indexer);
      const result = await suite.execute({ target_branch: 'main', runner: 'vitest' });
      expect(result.execution_command).toContain('user_service.test.ts');
    });
  });

  describe('workflow C risk score', () => {
    it('should expose integer score fields', () => {
      const result = scoreFromFactors({
        deepestImpactDepth: 3,
        alteredBoundaryRouteCount: 1,
        hasTestGap: true,
        hasForgotten: false,
      });
      expect(result.risk_score).toBeGreaterThanOrEqual(0);
      expect(result.risk_score).toBeLessThanOrEqual(100);
      expect(result.risk_level).toMatch(/LOW|MEDIUM|HIGH|CRITICAL/);
    });
  });
});
