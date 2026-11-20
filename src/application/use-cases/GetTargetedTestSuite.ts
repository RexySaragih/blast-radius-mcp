import { COVERAGE_UNRESOLVED_FACTOR } from '../../domain/Limits.js';
import { isTestFile, matchesRunner } from '../../domain/testFiles.js';
import { ApplicationError } from '../errors.js';
import type {
  GetTargetedTestSuite,
  GetTargetedTestSuiteInput,
  TargetedTestsOutput,
  TestRunner,
} from '../ports/inbound/GetTargetedTestSuite.js';
import type { GitPort } from '../ports/outbound/GitPort.js';
import { resolveTargetBranch } from './resolveTargetBranch.js';
import type { GraphStorePort } from '../ports/outbound/GraphStorePort.js';
import type { SourceParserPort } from '../ports/outbound/SourceParserPort.js';
import type { WorkspacePort } from '../ports/outbound/WorkspacePort.js';
import type { IndexWorkspaceUseCase } from './IndexWorkspace.js';
import { collectSemanticChanges } from './SemanticChanges.js';

const SUPPORTED: ReadonlySet<TestRunner> = new Set(['jest', 'vitest']);

export class GetTargetedTestSuiteUseCase implements GetTargetedTestSuite {
  constructor(
    private readonly git: GitPort,
    private readonly workspace: WorkspacePort,
    private readonly parser: SourceParserPort,
    private readonly graph: GraphStorePort,
    private readonly indexer: IndexWorkspaceUseCase,
    private readonly supportedRunners: ReadonlySet<string> = SUPPORTED,
  ) {}

  async execute(input: GetTargetedTestSuiteInput): Promise<TargetedTestsOutput> {
    const runner = runnerForWorkspace(input.runner, this.workspace);
    if (!this.supportedRunners.has(runner)) {
      throw new ApplicationError('UNSUPPORTED_RUNNER', input.runner);
    }
    await this.git.ensureRepo();
    this.indexer.execute();
    const targetBranch = await resolveTargetBranch(this.git, input.target_branch);

    const changed = await this.git.changedFiles(targetBranch);
    const allSymbols = this.graph.listSymbols();
    const { symbols: modified, unresolvedRefCount } = await collectSemanticChanges({
      git: this.git,
      workspace: this.workspace,
      parser: this.parser,
      graph: this.graph,
      targetBranch,
      paths: changed,
    });
    const testCases = this.graph.listTestCases(runner === 'jest' ? 'jest' : 'vitest');
    const allTests = allSymbols.filter(
      (symbol) => symbol.kind === 'test' || (isTestFile(symbol.filePath) && matchesRunner(symbol.filePath, runner)),
    );

    const linkedTestFiles = new Set<string>();
    let linkedModified = 0;
    for (const symbol of modified) {
      const incoming = this.graph.getIncomingEdges(symbol.id);
      let linked = false;
      for (const edge of incoming) {
        const caller = this.graph.getNode(edge.sourceId);
        if (!caller) continue;
        if (caller.kind === 'test' || isTestFile(caller.filePath)) {
          linkedTestFiles.add(caller.filePath);
          linked = true;
        }
      }
      // also scan test files that call this symbol by name via edges from test symbols
      for (const test of allTests) {
        const outgoing = this.graph.getOutgoingEdges(test.id);
        if (outgoing.some((edge) => edge.targetId === symbol.id)) {
          linkedTestFiles.add(test.filePath);
          linked = true;
        }
      }
      if (linked) linkedModified += 1;
    }

    // Prefer files that appear as test cases; fall back to linked files
    const targetedFiles = [...linkedTestFiles].filter((file) => matchesRunner(file, runner));
    const executionCommand = formatCommand(runner, targetedFiles);
    const coverage = computeCoverageConfidence(linkedModified, modified.length, unresolvedRefCount);

    return {
      total_project_tests: Math.max(testCases.length, allTests.length),
      targeted_test_count: targetedFiles.length,
      execution_command: executionCommand,
      coverage_confidence: coverage,
    };
  }
}

export function computeCoverageConfidence(
  linkedModifiedSymbols: number,
  modifiedSymbolCount: number,
  unresolvedCalls: number,
): number {
  const base = linkedModifiedSymbols / Math.max(1, modifiedSymbolCount);
  return round2(unresolvedCalls > 0 ? base * COVERAGE_UNRESOLVED_FACTOR : base);
}

const NODE_TEST_SCRIPT = /\bnode --test\b|\bnode:test\b/u;

function runnerForWorkspace(requested: TestRunner, workspace: WorkspacePort): TestRunner {
  if (requested !== 'vitest' && requested !== 'jest') return requested;
  const script = rootTestScript(workspace);
  if (!script || !NODE_TEST_SCRIPT.test(script)) return requested;
  if (requested === 'vitest' && /\bvitest\b/u.test(script)) return requested;
  if (requested === 'jest' && /\bjest\b/u.test(script)) return requested;
  return 'node_test';
}

function rootTestScript(workspace: WorkspacePort): string | null {
  const manifests = workspace.listSourceFiles().filter((filePath) => filePath === 'package.json' || filePath.endsWith('/package.json'));
  const root = manifests.find((filePath) => filePath === 'package.json') ?? manifests[0];
  if (!root) return null;
  try {
    const parsed = JSON.parse(workspace.readText(root)) as { scripts?: { test?: string } };
    return parsed.scripts?.test ?? null;
  } catch {
    return null;
  }
}

function formatCommand(runner: TestRunner, files: string[]): string {
  if (files.length === 0) return '';
  if (runner === 'vitest') return `npx vitest run ${files.join(' ')}`;
  if (runner === 'jest') return `npx jest ${files.join(' ')}`;
  if (runner === 'pytest') return `pytest ${files.join(' ')}`;
  if (runner === 'node_test') return `node --test ${files.join(' ')}`;
  if (runner === 'go_test') {
    const dirs = [...new Set(files.map((file) => dirname(file)))];
    return `go test ${dirs.join(' ')}`;
  }
  return '';
}

function dirname(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx <= 0 ? '.' : filePath.slice(0, idx);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
