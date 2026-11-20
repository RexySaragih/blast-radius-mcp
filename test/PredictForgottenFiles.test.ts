import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryGitAdapter } from '../src/adapters/outbound/memory/InMemoryGitAdapter.js';
import { PredictForgottenFilesUseCase } from '../src/application/use-cases/PredictForgottenFiles.js';
import { GitCli } from '../src/clients/git-client.js';
import { handlePredictForgottenFiles } from '../src/tools/predict-forgotten-files.js';

const tempDirs: string[] = [];

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

describe('Predict Forgotten Files', () => {
  describe('when 6 commits touch a.ts and 5 also touch b.ts', () => {
    it('should list b.ts at co_change_frequency 0.83', async () => {
      const git = new InMemoryGitAdapter();
      git.setHistory([
        { commit: '1', files: ['a.ts', 'b.ts'] },
        { commit: '2', files: ['a.ts', 'b.ts'] },
        { commit: '3', files: ['a.ts', 'b.ts'] },
        { commit: '4', files: ['a.ts', 'b.ts'] },
        { commit: '5', files: ['a.ts', 'b.ts'] },
        { commit: '6', files: ['a.ts'] },
      ]);
      const useCase = new PredictForgottenFilesUseCase(git);
      const result = await useCase.execute({ min_confidence: 0.7, modified_files: ['a.ts'] });
      const hit = result.unmodified_co_changes.find((row) => row.file === 'b.ts');
      expect(hit?.co_change_frequency).toBe(0.83);
    });
  });

  describe('when only 4 commits touch a.ts', () => {
    it('should omit b.ts at default confidence', async () => {
      const git = new InMemoryGitAdapter();
      git.setHistory([
        { commit: '1', files: ['a.ts', 'b.ts'] },
        { commit: '2', files: ['a.ts', 'b.ts'] },
        { commit: '3', files: ['a.ts', 'b.ts'] },
        { commit: '4', files: ['a.ts', 'b.ts'] },
      ]);
      const useCase = new PredictForgottenFilesUseCase(git);
      const result = await useCase.execute({ min_confidence: 0.7, modified_files: ['a.ts'] });
      expect(result.unmodified_co_changes.some((row) => row.file === 'b.ts')).toBe(false);
    });
  });

  describe('when git history touches a.ts and b.ts together', () => {
    it('should flag b.ts at 0.83 through GitCli', async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-radius-cochange-'));
      tempDirs.push(root);
      git(root, ['init']);
      for (let index = 0; index < 5; index += 1) {
        fs.writeFileSync(path.join(root, 'a.ts'), `export const a = ${index};\n`);
        fs.writeFileSync(path.join(root, 'b.ts'), `export const b = ${index};\n`);
        git(root, ['add', 'a.ts', 'b.ts']);
        git(root, ['commit', '-m', `both ${index}`]);
      }
      fs.writeFileSync(path.join(root, 'a.ts'), 'export const a = 9;\n');
      git(root, ['add', 'a.ts']);
      git(root, ['commit', '-m', 'only a']);

      const useCase = new PredictForgottenFilesUseCase(new GitCli(root));
      const result = await useCase.execute({ min_confidence: 0.7, modified_files: ['a.ts'] });
      const hit = result.unmodified_co_changes.find((row) => row.file === 'b.ts');
      expect(hit?.co_change_frequency).toBe(0.83);
      expect(hit?.reason).toContain('a.ts');
    });
  });

  describe('when a source file is untracked', () => {
    it('should include it in changed files', async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-radius-untracked-'));
      tempDirs.push(root);
      git(root, ['init']);
      fs.writeFileSync(path.join(root, 'a.ts'), 'export const a = 1;\n');
      git(root, ['add', 'a.ts']);
      git(root, ['commit', '-m', 'init']);
      fs.writeFileSync(path.join(root, 'new.ts'), 'export const n = 1;\n');

      const changed = await new GitCli(root).changedFiles('HEAD');
      expect(changed).toContain('new.ts');
    });
  });

  describe('when the directory is not a git repo', () => {
    it('should return NOT_A_REPOSITORY', async () => {
      const git = new InMemoryGitAdapter();
      git.setRepo(false);
      const useCase = new PredictForgottenFilesUseCase(git);
      const response = await handlePredictForgottenFiles(useCase, { modified_files: ['a.ts'] });
      expect(response.content[0]?.text).toContain('NOT_A_REPOSITORY');
    });
  });
});
