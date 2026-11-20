import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryGraphAdapter } from '../src/adapters/outbound/memory/InMemoryGraphAdapter.js';
import { DiffContractUseCase } from '../src/application/use-cases/DiffContract.js';
import { IndexWorkspaceUseCase } from '../src/application/use-cases/IndexWorkspace.js';
import { TreeSitterParser } from '../src/clients/treesitter-client.js';
import { WorkspaceFiles } from '../src/clients/workspace-client.js';
import { ApplicationError } from '../src/application/errors.js';
import { handleDiffContractAgainstSpec } from '../src/tools/diff-contract-against-spec.js';

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

function copyFixture(name: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `blast-radius-${name}-`));
  tempDirs.push(root);
  fs.cpSync(path.resolve(`test/fixtures/${name}`), root, { recursive: true });
  return root;
}

async function run(root: string, specPath: string, modifiedController?: string) {
  const workspace = new WorkspaceFiles(root);
  const graph = new InMemoryGraphAdapter();
  const indexer = new IndexWorkspaceUseCase(workspace, parser, graph);
  const useCase = new DiffContractUseCase(workspace, graph, indexer);
  return useCase.execute({ spec_path: specPath, modified_controller: modifiedController });
}

describe('Diff Contract', () => {
  describe('when OpenAPI drifts from implementation', () => {
    it('should report MISSING_IN_SPEC for PUT /api/v1/users/profile', async () => {
      const root = copyFixture('openapi-drift');
      const result = await run(root, 'openapi.yaml');
      const text = JSON.stringify(result);
      expect(text).toContain('MISSING_IN_SPEC');
      expect(text).toContain('/api/v1/users/profile');
      expect(text).toContain('/api/v1/users/avatar');
    });
  });

  describe('when modified_controller selects one file', () => {
    it('should report only that file’s routes', async () => {
      const root = copyFixture('openapi-drift');
      fs.mkdirSync(path.join(root, 'src/controllers'), { recursive: true });
      fs.writeFileSync(
        path.join(root, 'src/controllers/health.ts'),
        'export function healthHandler() {\n  return null;\n}\nexport function register(app: { get: (path: string, handler: () => unknown) => void }) {\n  app.get(\'/health\', healthHandler);\n}\n',
        'utf8',
      );
      const selected = await run(root, 'openapi.yaml', 'src/controllers/health.ts');
      const selectedText = JSON.stringify(selected);
      const all = await run(root, 'openapi.yaml');
      const allText = JSON.stringify(all);

      expect(selectedText).toContain('/health');
      expect(selectedText).not.toContain('/api/v1/users/profile');
      expect(allText).toContain('/api/v1/users/profile');
    });
  });

  describe('when GraphQL drifts from implementation', () => {
    it('should report MISSING_IN_SPEC for newField', async () => {
      const root = copyFixture('graphql-drift');
      const result = await run(root, 'schema.graphql');
      const text = JSON.stringify(result);
      expect(text).toContain('MISSING_IN_SPEC');
      expect(text).toContain('newField');
      expect(text).toContain('displayName');
      expect(text).toContain('TYPE_MISMATCH');
    });
  });

  describe('when Protobuf drifts and path escapes', () => {
    it('should report nickname missing and PATH_ESCAPE outside root', async () => {
      const root = copyFixture('proto-drift');
      const result = await run(root, 'user.proto');
      const text = JSON.stringify(result);
      expect(text).toContain('MISSING_IN_SPEC');
      expect(text).toContain('nickname');
      expect(text).toContain('avatarUrl');

      const workspace = new WorkspaceFiles(root);
      const graph = new InMemoryGraphAdapter();
      const indexer = new IndexWorkspaceUseCase(workspace, parser, graph);
      const useCase = new DiffContractUseCase(workspace, graph, indexer);
      const response = await handleDiffContractAgainstSpec(useCase, {
        spec_path: '../outside.yaml',
      });
      expect(response.content[0]?.text).toContain('PATH_ESCAPE');
      expect(ApplicationError).toBeTruthy();
    });
  });
});
