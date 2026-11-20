import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TraceEnvVariableReachUseCase } from '../src/application/use-cases/TraceEnvVariableReach.js';
import { WorkspaceFiles } from '../src/clients/workspace-client.js';
import { handleTraceEnvVariableReach } from '../src/tools/trace-env-variable-reach.js';

const FIXTURE = path.resolve('test/fixtures/env-flag');
const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.ENABLE_NEW_CHECKOUT;
  delete process.env.FORCE_COLOR;
});

function copyFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-radius-env-'));
  tempDirs.push(root);
  fs.cpSync(FIXTURE, root, { recursive: true });
  return root;
}

describe('Trace Env Variable Reach', () => {
  describe('when ENABLE_NEW_CHECKOUT is set to a secret', () => {
    it('should list file and line without the secret value', async () => {
      process.env.ENABLE_NEW_CHECKOUT = 'super-secret-value';
      const root = copyFixture();
      const useCase = new TraceEnvVariableReachUseCase(new WorkspaceFiles(root));
      const result = await useCase.execute({ env_var_name: 'ENABLE_NEW_CHECKOUT' });
      const text = JSON.stringify(result);
      expect(result.sites.length).toBeGreaterThanOrEqual(1);
      expect(result.sites[0]?.file).toContain('flag.ts');
      expect(text).not.toContain('super-secret-value');
    });
  });

  describe('when env_var_name is invalid', () => {
    it('should return INVALID', async () => {
      const root = copyFixture();
      const useCase = new TraceEnvVariableReachUseCase(new WorkspaceFiles(root));
      const response = await handleTraceEnvVariableReach(useCase, { env_var_name: 'not valid' });
      expect(response.content[0]?.text).toContain('INVALID');
    });
  });

  describe('when the name is read from an injected env object', () => {
    it('should list env.FORCE_COLOR without the live value', async () => {
      process.env.FORCE_COLOR = 'super-secret-value';
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-radius-env-injected-'));
      tempDirs.push(root);
      fs.writeFileSync(
        path.join(root, 'style.ts'),
        'export function style(env: { FORCE_COLOR?: string }) {\n  return env.FORCE_COLOR ?? env["NO_COLOR"];\n}\n',
        'utf8',
      );
      const result = await new TraceEnvVariableReachUseCase(new WorkspaceFiles(root)).execute({
        env_var_name: 'FORCE_COLOR',
      });
      const text = JSON.stringify(result);

      expect(result.sites.some((site) => site.file.endsWith('style.ts'))).toBe(true);
      expect(text).toContain('env.FORCE_COLOR');
      expect(text).not.toContain('super-secret-value');
    });
  });

  describe('when both dot and bracket forms exist', () => {
    it('should list both lines without the sentinel value', async () => {
      process.env.ENABLE_NEW_CHECKOUT = 'super-secret-value';
      const root = copyFixture();
      const useCase = new TraceEnvVariableReachUseCase(new WorkspaceFiles(root));
      const result = await useCase.execute({ env_var_name: 'ENABLE_NEW_CHECKOUT' });
      expect(result.sites.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(result)).not.toContain('super-secret-value');
    });
  });
});
