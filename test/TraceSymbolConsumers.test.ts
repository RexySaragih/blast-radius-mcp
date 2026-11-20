import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BlastRadiusTestDriver } from '../src/adapters/inbound/test/BlastRadiusTestDriver.js';
import { InMemoryGraphAdapter } from '../src/adapters/outbound/memory/InMemoryGraphAdapter.js';
import { IndexWorkspaceUseCase } from '../src/application/use-cases/IndexWorkspace.js';
import { TraceSymbolConsumersUseCase } from '../src/application/use-cases/TraceSymbolConsumers.js';
import { TraverseCallers } from '../src/application/use-cases/TraverseCallers.js';
import { TreeSitterParser } from '../src/clients/treesitter-client.js';
import { WorkspaceFiles } from '../src/clients/workspace-client.js';
import { logTool } from '../src/composition/createRuntime.js';
import { handleTraceSymbolConsumers } from '../src/tools/trace-symbol-consumers.js';

const FIXTURE = path.resolve('test/fixtures/refactor-auth');
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-radius-auth-'));
  tempDirs.push(root);
  fs.cpSync(FIXTURE, root, { recursive: true });
  return root;
}

function buildDriver(root: string) {
  const workspace = new WorkspaceFiles(root);
  const graph = new InMemoryGraphAdapter();
  const indexer = new IndexWorkspaceUseCase(workspace, parser, graph);
  const traverseCallers = new TraverseCallers(graph);
  const traceSymbolConsumers = new TraceSymbolConsumersUseCase(
    workspace,
    graph,
    indexer,
    traverseCallers,
  );
  return {
    driver: new BlastRadiusTestDriver({ traverseCallers, traceSymbolConsumers }),
    traceSymbolConsumers,
  };
}

describe('Trace Symbol Consumers', () => {
  describe('when tracing AuthService.validateSession on refactor-auth', () => {
    it('should return 3 callers, 1 route, and 1 event handler', async () => {
      const root = copyFixture();
      const { driver } = buildDriver(root);

      const result = await driver.traceSymbolConsumers({
        symbol_name: 'AuthService.validateSession',
        source_file: 'src/auth/AuthService.ts',
        max_depth: 3,
      });

      expect(result.callers).toHaveLength(3);
      expect(result.routes).toHaveLength(1);
      expect(result.event_handlers).toHaveLength(1);
    });
  });

  describe('when the symbol is unknown', () => {
    it('should return SYMBOL_NOT_FOUND without a stack frame', async () => {
      const root = copyFixture();
      const { traceSymbolConsumers } = buildDriver(root);
      const response = await handleTraceSymbolConsumers(traceSymbolConsumers, {
        symbol_name: 'Missing.method',
        source_file: 'src/auth/AuthService.ts',
        max_depth: 3,
      });
      const text = response.content[0]?.text ?? '';

      expect(response.isError).toBe(true);
      expect(text).toContain('SYMBOL_NOT_FOUND');
      expect(text).not.toMatch(/\sat\s/);
    });
  });

  describe('when a successful call is logged', () => {
    it('should include duration_ms and omit VALIDATE_SENTINEL', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      logTool('trace_symbol_consumers', 'ok', 12);
      const line = String(spy.mock.calls[0]?.[0] ?? '');
      spy.mockRestore();

      expect(line).toContain('duration_ms=12');
      expect(line).not.toContain('VALIDATE_SENTINEL');
    });
  });
});
