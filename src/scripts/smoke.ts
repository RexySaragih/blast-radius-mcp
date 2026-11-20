import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InMemoryGraphAdapter } from '../adapters/outbound/memory/InMemoryGraphAdapter.js';
import { IndexWorkspaceUseCase } from '../application/use-cases/IndexWorkspace.js';
import { TraceSymbolConsumersUseCase } from '../application/use-cases/TraceSymbolConsumers.js';
import { TraverseCallers } from '../application/use-cases/TraverseCallers.js';
import { TreeSitterParser } from '../clients/treesitter-client.js';
import { WorkspaceFiles } from '../clients/workspace-client.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.resolve(here, '../../test/fixtures/refactor-auth');

export async function runConnectionSmoke(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-radius-smoke-'));
  fs.cpSync(fixture, root, { recursive: true });
  const parser = await TreeSitterParser.create();
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
  if (result.callers.length !== 3 || result.routes.length !== 1 || result.event_handlers.length !== 1) {
    throw new Error(
      `smoke failed callers=${result.callers.length} routes=${result.routes.length} events=${result.event_handlers.length}`,
    );
  }
  console.error('smoke ok');
  fs.rmSync(root, { recursive: true, force: true });
}

const isEntry = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  runConnectionSmoke().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
