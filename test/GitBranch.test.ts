import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryGraphAdapter } from '../src/adapters/outbound/memory/InMemoryGraphAdapter.js';
import { CalculateChangeRiskScoreUseCase } from '../src/application/use-cases/CalculateChangeRiskScore.js';
import { IndexWorkspaceUseCase } from '../src/application/use-cases/IndexWorkspace.js';
import { PredictForgottenFilesUseCase } from '../src/application/use-cases/PredictForgottenFiles.js';
import { TraverseCallers } from '../src/application/use-cases/TraverseCallers.js';
import { GitCli } from '../src/clients/git-client.js';
import { TreeSitterParser } from '../src/clients/treesitter-client.js';
import { WorkspaceFiles } from '../src/clients/workspace-client.js';
import { handleCalculateChangeRiskScore } from '../src/tools/calculate-change-risk-score.js';

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

function git(cwd: string, args: string[]): void {
  execFileSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=test', ...args], {
    cwd,
    stdio: 'ignore',
  });
}

function masterRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-radius-master-'));
  tempDirs.push(root);
  git(root, ['init', '-b', 'master']);
  fs.writeFileSync(path.join(root, 'a.ts'), 'export const value = 1;\n', 'utf8');
  git(root, ['add', 'a.ts']);
  git(root, ['commit', '-m', 'init']);
  fs.writeFileSync(path.join(root, 'a.ts'), 'export const value = 2;\n', 'utf8');
  return root;
}

function riskUseCase(root: string): CalculateChangeRiskScoreUseCase {
  const workspace = new WorkspaceFiles(root);
  const graph = new InMemoryGraphAdapter();
  const gitCli = new GitCli(root);
  const indexer = new IndexWorkspaceUseCase(workspace, parser, graph);
  return new CalculateChangeRiskScoreUseCase(
    gitCli,
    workspace,
    parser,
    graph,
    indexer,
    new TraverseCallers(graph),
    new PredictForgottenFilesUseCase(gitCli),
  );
}

describe('Git default branch', () => {
  describe('when the only branch is master', () => {
    it('should list changed files when target_branch is omitted', async () => {
      const root = masterRepo();
      const gitCli = new GitCli(root);
      const branch = await gitCli.defaultBranch();
      const changed = await gitCli.changedFiles(branch);

      expect(branch).toBe('master');
      expect(changed).toContain('a.ts');

      const result = await riskUseCase(root).execute({});
      expect(result.risk_score).toBeGreaterThanOrEqual(0);
    });

    it('should return INVALID without git stderr when target_branch is main', async () => {
      const root = masterRepo();
      const response = await handleCalculateChangeRiskScore(riskUseCase(root), { target_branch: 'main' });
      const text = response.content[0]?.text ?? '';

      expect(response.isError).toBe(true);
      expect(text).toContain('INVALID');
      expect(text).toContain('unknown target_branch');
      expect(text).not.toContain('fatal:');
    });
  });
});
