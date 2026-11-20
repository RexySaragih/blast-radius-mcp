import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BlastRadiusTestDriver } from '../src/adapters/inbound/test/BlastRadiusTestDriver.js';
import { InMemoryGraphAdapter } from '../src/adapters/outbound/memory/InMemoryGraphAdapter.js';
import { InMemoryGitAdapter } from '../src/adapters/outbound/memory/InMemoryGitAdapter.js';
import { AnalyzeBlastRadiusUseCase } from '../src/application/use-cases/AnalyzeBlastRadius.js';
import { IndexWorkspaceUseCase } from '../src/application/use-cases/IndexWorkspace.js';
import { PredictForgottenFilesUseCase } from '../src/application/use-cases/PredictForgottenFiles.js';
import { TraverseCallers } from '../src/application/use-cases/TraverseCallers.js';
import { TreeSitterParser } from '../src/clients/treesitter-client.js';
import { WorkspaceFiles } from '../src/clients/workspace-client.js';
import { MAX_DIFF_CHARS } from '../src/domain/Limits.js';
import { handleAnalyzeBlastRadius } from '../src/tools/analyze-blast-radius.js';

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-radius-email-'));
  tempDirs.push(root);
  fs.cpSync(FIXTURE, root, { recursive: true });
  return root;
}

function buildDriver(root: string) {
  const workspace = new WorkspaceFiles(root);
  const graph = new InMemoryGraphAdapter();
  const indexer = new IndexWorkspaceUseCase(workspace, parser, graph);
  const traverseCallers = new TraverseCallers(graph);
  const git = new InMemoryGitAdapter();
  git.setRepo(false);
  const analyzeBlastRadius = new AnalyzeBlastRadiusUseCase(
    workspace,
    graph,
    parser,
    indexer,
    traverseCallers,
    new PredictForgottenFilesUseCase(git),
  );
  return {
    driver: new BlastRadiusTestDriver({ traverseCallers, analyzeBlastRadius }),
    analyzeBlastRadius,
  };
}

const SIGNATURE_DIFF = `diff --git a/src/services/user.ts b/src/services/user.ts
--- a/src/services/user.ts
+++ b/src/services/user.ts
@@ -1,6 +1,7 @@
 export class UserService {
-  updateEmail(id: string, email: string): void {
+  updateEmail(id: string, email: string, verified: boolean): void {
     void id;
     void email;
+    void verified;
   }
 }
`;

const WHITESPACE_AFTER = `export class UserService {
  updateEmail(id: string, email: string, verified: boolean): void {
    void id;

    void email;
    void verified;
  }
}
`;

const WHITESPACE_DIFF = `diff --git a/src/services/user.ts b/src/services/user.ts
--- a/src/services/user.ts
+++ b/src/services/user.ts
@@ -1,7 +1,8 @@
 export class UserService {
   updateEmail(id: string, email: string, verified: boolean): void {
     void id;
+
     void email;
     void verified;
   }
 }
`;

describe('Analyze Blast Radius', () => {
  describe('when analyzing the user-email signature diff', () => {
    it('should report signature_modified, direct_callers 1, and a risk_level band', async () => {
      const root = copyFixture();
      const { driver } = buildDriver(root);

      const result = await driver.analyzeBlastRadius({
        diff: SIGNATURE_DIFF,
        max_depth: 3,
        include_tests: true,
      });

      expect(result.modified_symbols.some((symbol) => symbol.change === 'signature_modified')).toBe(
        true,
      );
      expect(result.impact_summary.direct_callers).toBe(1);
      expect(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).toContain(result.impact_summary.risk_level);
    });
  });

  describe('when include_tests is false', () => {
    it('should omit user_service.test.ts from the formatted output', async () => {
      const root = copyFixture();
      const { analyzeBlastRadius } = buildDriver(root);
      const response = await handleAnalyzeBlastRadius(analyzeBlastRadius, {
        diff: SIGNATURE_DIFF,
        max_depth: 3,
        include_tests: false,
      });
      const text = response.content[0]?.text ?? '';

      expect(text).not.toContain('user_service.test.ts');
    });
  });

  describe('when the diff is whitespace-only', () => {
    it('should produce zero modified_symbols', async () => {
      const root = copyFixture();
      fs.writeFileSync(path.join(root, 'src/services/user.ts'), WHITESPACE_AFTER);
      const { driver } = buildDriver(root);

      const result = await driver.analyzeBlastRadius({
        diff: WHITESPACE_DIFF,
        max_depth: 3,
        include_tests: true,
      });

      expect(result.modified_symbols).toHaveLength(0);
    });
  });

  describe('when the diff exceeds MAX_DIFF_CHARS', () => {
    it('should return DIFF_TOO_LARGE without a caller list', async () => {
      const root = copyFixture();
      const { analyzeBlastRadius } = buildDriver(root);
      const hugeDiff = 'x'.repeat(MAX_DIFF_CHARS + 1);
      const response = await handleAnalyzeBlastRadius(analyzeBlastRadius, {
        diff: hugeDiff,
        max_depth: 3,
        include_tests: true,
      });
      const text = response.content[0]?.text ?? '';

      expect(response.isError).toBe(true);
      expect(text).toContain('DIFF_TOO_LARGE');
      expect(text).not.toContain('impact_tree');
      expect(text).not.toContain('callers:');
    });
  });
});
