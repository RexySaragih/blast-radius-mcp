import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { GitCli } from '../clients/git-client.js';
import { SqliteGraphAdapter } from '../clients/sqlite-graph-client.js';
import { TreeSitterParser } from '../clients/treesitter-client.js';
import { WorkspaceFiles } from '../clients/workspace-client.js';
import { AnalyzeBlastRadiusUseCase } from '../application/use-cases/AnalyzeBlastRadius.js';
import { CalculateChangeRiskScoreUseCase } from '../application/use-cases/CalculateChangeRiskScore.js';
import { DiffContractUseCase } from '../application/use-cases/DiffContract.js';
import { GetTargetedTestSuiteUseCase } from '../application/use-cases/GetTargetedTestSuite.js';
import { IndexWorkspaceUseCase } from '../application/use-cases/IndexWorkspace.js';
import { PredictForgottenFilesUseCase } from '../application/use-cases/PredictForgottenFiles.js';
import { SimulateMigrationLockImpactUseCase } from '../application/use-cases/SimulateMigrationLockImpact.js';
import { TraceEnvVariableReachUseCase } from '../application/use-cases/TraceEnvVariableReach.js';
import { TraceSymbolConsumersUseCase } from '../application/use-cases/TraceSymbolConsumers.js';
import { TraverseCallers } from '../application/use-cases/TraverseCallers.js';
import type { AnalyzeBlastRadius } from '../application/ports/inbound/AnalyzeBlastRadius.js';
import type { CalculateChangeRiskScore } from '../application/ports/inbound/CalculateChangeRiskScore.js';
import type { DiffContractAgainstSpec } from '../application/ports/inbound/DiffContractAgainstSpec.js';
import type { GetTargetedTestSuite } from '../application/ports/inbound/GetTargetedTestSuite.js';
import type { PredictForgottenFiles } from '../application/ports/inbound/PredictForgottenFiles.js';
import type { SimulateMigrationLockImpact } from '../application/ports/inbound/SimulateMigrationLockImpact.js';
import type { TraceEnvVariableReach } from '../application/ports/inbound/TraceEnvVariableReach.js';
import type { TraceSymbolConsumers } from '../application/ports/inbound/TraceSymbolConsumers.js';
import type { GraphStorePort } from '../application/ports/outbound/GraphStorePort.js';
import type { GitPort } from '../application/ports/outbound/GitPort.js';
import type { SourceParserPort } from '../application/ports/outbound/SourceParserPort.js';
import type { WorkspacePort } from '../application/ports/outbound/WorkspacePort.js';
import { registerTools, type ToolHandler } from './registerTools.js';

export const SERVER_NAME = 'blast-radius-mcp';
export const SERVER_VERSION = '1.0.0';

export type BlastRadiusRuntime = {
  root: string;
  graph: GraphStorePort;
  parser: SourceParserPort;
  workspace: WorkspacePort;
  git: GitPort;
  indexer: IndexWorkspaceUseCase;
  traverseCallers: TraverseCallers;
  traceSymbolConsumers: TraceSymbolConsumers;
  analyzeBlastRadius: AnalyzeBlastRadius;
  getTargetedTestSuite: GetTargetedTestSuite;
  diffContract: DiffContractAgainstSpec;
  traceEnv: TraceEnvVariableReach;
  predictForgotten: PredictForgottenFiles;
  calculateRisk: CalculateChangeRiskScore;
  simulateMigration: SimulateMigrationLockImpact;
};

export type RuntimePorts = {
  graph: GraphStorePort;
  parser: SourceParserPort;
  workspace: WorkspacePort;
  git: GitPort;
  supportedRunners?: ReadonlySet<string>;
};

export function resolveWorkspaceRoot(cwd = process.cwd()): string {
  const fromEnv = process.env.BLAST_RADIUS_ROOT;
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }
  return GitCli.detectToplevel(cwd) ?? cwd;
}

export function createUseCases(ports: RuntimePorts): Omit<
  BlastRadiusRuntime,
  'root' | 'graph' | 'parser' | 'workspace' | 'git'
> {
  const indexer = new IndexWorkspaceUseCase(ports.workspace, ports.parser, ports.graph);
  const traverseCallers = new TraverseCallers(ports.graph);
  const traceSymbolConsumers = new TraceSymbolConsumersUseCase(
    ports.workspace,
    ports.graph,
    indexer,
    traverseCallers,
  );
  const predictForgotten = new PredictForgottenFilesUseCase(ports.git);
  const analyzeBlastRadius = new AnalyzeBlastRadiusUseCase(
    ports.workspace,
    ports.graph,
    ports.parser,
    indexer,
    traverseCallers,
    predictForgotten,
  );
  const getTargetedTestSuite = new GetTargetedTestSuiteUseCase(
    ports.git,
    ports.workspace,
    ports.parser,
    ports.graph,
    indexer,
    ports.supportedRunners,
  );
  const calculateRisk = new CalculateChangeRiskScoreUseCase(
    ports.git,
    ports.workspace,
    ports.parser,
    ports.graph,
    indexer,
    traverseCallers,
    predictForgotten,
  );
  const diffContract = new DiffContractUseCase(ports.workspace, ports.graph, indexer);
  const traceEnv = new TraceEnvVariableReachUseCase(ports.workspace);
  const simulateMigration = new SimulateMigrationLockImpactUseCase(ports.workspace);

  return {
    indexer,
    traverseCallers,
    traceSymbolConsumers,
    analyzeBlastRadius,
    getTargetedTestSuite,
    diffContract,
    traceEnv,
    predictForgotten,
    calculateRisk,
    simulateMigration,
  };
}

export async function createRuntime(root = resolveWorkspaceRoot()): Promise<BlastRadiusRuntime> {
  const graph = new SqliteGraphAdapter(root);
  const parser = await TreeSitterParser.create();
  const workspace = new WorkspaceFiles(root);
  const git = new GitCli(root);
  const useCases = createUseCases({
    graph,
    parser,
    workspace,
    git,
    supportedRunners: new Set(['jest', 'vitest', 'pytest', 'go_test', 'node_test']),
  });
  workspace.watch((relativePaths) => {
    runIndex(() => useCases.indexer.execute(relativePaths));
  });
  runIndex(() => useCases.indexer.execute());
  return {
    root,
    graph,
    parser,
    workspace,
    git,
    ...useCases,
  };
}

function runIndex(index: () => void): void {
  try {
    index();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'index failed';
    console.error(`[mcp=${SERVER_NAME} tool=index status=error ${message}]`);
  }
}

export function logTool(tool: string, status: 'ok' | 'error', durationMs: number, code?: string): void {
  const extra = code ? ` code=${code}` : '';
  console.error(`[mcp=${SERVER_NAME} tool=${tool} status=${status} duration_ms=${durationMs}${extra}]`);
}

export async function startServer(): Promise<void> {
  const runtime = await createRuntime();
  const { tools, handlers } = registerTools(runtime);

  const server = new Server({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler: ToolHandler | undefined = handlers[name];
    if (!handler) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    const started = Date.now();
    try {
      const result = await handler(args ?? {});
      logTool(name, result.isError ? 'error' : 'ok', Date.now() - started);
      return result;
    } catch (error: unknown) {
      logTool(name, 'error', Date.now() - started);
      if (error instanceof McpError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : 'Unknown tool error';
      throw new McpError(ErrorCode.InternalError, message);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${SERVER_NAME} ready root=${runtime.root}`);
}
