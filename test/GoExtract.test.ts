import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryGitAdapter } from '../src/adapters/outbound/memory/InMemoryGitAdapter.js';
import { InMemoryGraphAdapter } from '../src/adapters/outbound/memory/InMemoryGraphAdapter.js';
import { GetTargetedTestSuiteUseCase } from '../src/application/use-cases/GetTargetedTestSuite.js';
import { IndexWorkspaceUseCase } from '../src/application/use-cases/IndexWorkspace.js';
import { TraceEnvVariableReachUseCase } from '../src/application/use-cases/TraceEnvVariableReach.js';
import { TreeSitterParser } from '../src/clients/treesitter-client.js';
import { WorkspaceFiles } from '../src/clients/workspace-client.js';

const FIXTURE = path.resolve('test/fixtures/go-charge');
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

describe('Go Extract', () => {
  describe('when indexing go-charge', () => {
    it('should index a function symbol named Charge', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-radius-go-'));
      tempDirs.push(root);
      fs.cpSync(FIXTURE, root, { recursive: true });
      const workspace = new WorkspaceFiles(root);
      const graph = new InMemoryGraphAdapter();
      new IndexWorkspaceUseCase(workspace, parser, graph).execute();
      expect(graph.listSymbols().some((symbol) => symbol.name === 'Charge')).toBe(true);
    });
  });

  describe('when runner is go_test', () => {
    it('should include go test and the package directory', async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-radius-go-suite-'));
      tempDirs.push(root);
      fs.cpSync(FIXTURE, root, { recursive: true });
      const workspace = new WorkspaceFiles(root);
      const graph = new InMemoryGraphAdapter();
      const git = new InMemoryGitAdapter();
      git.setWorkingTree(['charge.go']);
      const indexer = new IndexWorkspaceUseCase(workspace, parser, graph);
      indexer.execute();
      const useCase = new GetTargetedTestSuiteUseCase(
        git,
        workspace,
        parser,
        graph,
        indexer,
        new Set(['jest', 'vitest', 'pytest', 'go_test']),
      );
      const result = await useCase.execute({ target_branch: 'main', runner: 'go_test' });
      expect(result.execution_command).toContain('go test');
      expect(result.execution_command.length).toBeGreaterThan('go test'.length);
    });
  });

  describe('when tracing os.Getenv', () => {
    it('should include the Go file path and not a secret value', async () => {
      process.env.ENABLE_NEW_CHECKOUT = 'super-secret-value';
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-radius-go-env-'));
      tempDirs.push(root);
      fs.cpSync(FIXTURE, root, { recursive: true });
      const result = await new TraceEnvVariableReachUseCase(new WorkspaceFiles(root)).execute({
        env_var_name: 'ENABLE_NEW_CHECKOUT',
      });
      expect(result.sites.some((site) => site.file.endsWith('charge.go'))).toBe(true);
      expect(JSON.stringify(result)).not.toContain('super-secret-value');
      delete process.env.ENABLE_NEW_CHECKOUT;
    });
  });
});
