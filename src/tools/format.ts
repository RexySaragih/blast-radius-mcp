import { MAX_FORMAT_CHARS, MAX_IMPACT_NODES } from '../domain/Limits.js';

export type ImpactRow = {
  name: string;
  file: string;
  line: number;
  depth: number;
  route?: string;
};

export type TraceFormatInput = {
  symbol: string;
  callers: ImpactRow[];
  routes: string[];
  eventHandlers: string[];
};

export type AnalyzeFormatInput = {
  modifiedSymbols: string[];
  directCallers: number;
  indirectCallers: number;
  affectedRoutes: number;
  affectedDbModels: number;
  riskLevel: string;
  riskScore: number;
  impactTree: ImpactRow[];
  affectedTestFiles: string[];
  unresolvedCalls: number;
};

export type FormatResult = {
  text: string;
  truncated: boolean;
  omittedCount: number;
};

export function formatTraceConsumers(input: TraceFormatInput): FormatResult {
  const capped = capRows(input.callers);
  const lines = [
    'symbol:',
    `  ${input.symbol}`,
    'callers:',
    ...capped.rows.map(formatCallerRow),
    'routes:',
    ...orEmpty(input.routes),
    'event_handlers:',
    ...orEmpty(input.eventHandlers),
    `truncated: ${capped.truncated}`,
  ];
  if (capped.truncated) lines.push(`omitted_count: ${capped.omittedCount}`);
  return finalize(lines.join('\n'), capped);
}

export function formatAnalyzeBlastRadius(input: AnalyzeFormatInput): FormatResult {
  const capped = capRows(input.impactTree);
  const lines = [
    'modified_symbols:',
    ...orEmpty(input.modifiedSymbols),
    'impact_summary:',
    `  direct_callers: ${input.directCallers}`,
    `  indirect_callers: ${input.indirectCallers}`,
    `  affected_routes: ${input.affectedRoutes}`,
    `  affected_db_models: ${input.affectedDbModels}`,
    `  risk_level: ${input.riskLevel}`,
    `  risk_score: ${input.riskScore}`,
    'impact_tree:',
    ...capped.rows.map(formatCallerRow),
    'affected_test_files:',
    ...orEmpty(input.affectedTestFiles),
    `unresolved_calls: ${input.unresolvedCalls}`,
    `truncated: ${capped.truncated}`,
  ];
  if (capped.truncated) lines.push(`omitted_count: ${capped.omittedCount}`);
  return finalize(lines.join('\n'), capped);
}

export function formatTargetedTests(input: {
  totalProjectTests: number;
  targetedTestCount: number;
  executionCommand: string;
  coverageConfidence: number;
}): string {
  return [
    `total_project_tests: ${input.totalProjectTests}`,
    `targeted_test_count: ${input.targetedTestCount}`,
    `execution_command: ${input.executionCommand}`,
    `coverage_confidence: ${input.coverageConfidence}`,
  ].join('\n');
}

export function formatForgottenFiles(
  rows: Array<{ file: string; coChangeFrequency: number; reason: string }>,
): string {
  const lines = ['unmodified_co_changes:'];
  if (rows.length === 0) {
    lines.push('  (none)');
    return lines.join('\n');
  }
  for (const row of rows) {
    lines.push(`  - file: ${row.file}`);
    lines.push(`    co_change_frequency: ${row.coChangeFrequency.toFixed(2)}`);
    lines.push(`    reason: ${row.reason}`);
  }
  return lines.join('\n');
}

export function formatRiskScore(input: {
  riskScore: number;
  riskLevel: string;
  depthPoints: number;
  apiPoints: number;
  testGapPoints: number;
  forgottenPoints: number;
}): string {
  return [
    `risk_score: ${input.riskScore}`,
    `risk_level: ${input.riskLevel}`,
    `depth_points: ${input.depthPoints}`,
    `api_points: ${input.apiPoints}`,
    `test_gap_points: ${input.testGapPoints}`,
    `forgotten_points: ${input.forgottenPoints}`,
  ].join('\n');
}

export function formatContractDiff(
  rows: Array<{ code: string; path: string; detail?: string }>,
): string {
  const lines = ['drift:'];
  if (rows.length === 0) {
    lines.push('  (none)');
    return lines.join('\n');
  }
  for (const row of rows) {
    lines.push(`  - ${row.code} ${row.path}${row.detail ? ` ${row.detail}` : ''}`);
  }
  return lines.join('\n');
}

export function formatEnvReach(rows: Array<{ file: string; line: number; snippet: string }>): string {
  const lines = ['reads:'];
  if (rows.length === 0) {
    lines.push('  (none)');
    return lines.join('\n');
  }
  for (const row of rows) {
    lines.push(`  - ${row.file}:${row.line} ${row.snippet}`);
  }
  return lines.join('\n');
}

export function formatMigrationLock(input: {
  lockRisk: string;
  findings: Array<{ code: string; detail: string }>;
}): string {
  const lines = [`lock_risk: ${input.lockRisk}`, 'findings:'];
  if (input.findings.length === 0) {
    lines.push('  (none)');
    return lines.join('\n');
  }
  for (const finding of input.findings) {
    lines.push(`  - ${finding.code}: ${finding.detail}`);
  }
  return lines.join('\n');
}

export function formatToolError(code: string, message: string, error?: Error): string {
  const safeMessage = stripStack(message);
  const safeError = error ? stripStack(error.message) : '';
  return [`error: ${code}`, `message: ${safeMessage}${safeError && safeError !== safeMessage ? ` (${safeError})` : ''}`].join(
    '\n',
  );
}

export function stripStack(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/\s+at\s+/.test(line))
    .join('\n')
    .trim();
}

function formatCallerRow(row: ImpactRow): string {
  const route = row.route ? ` route=${row.route}` : '';
  return `  - ${row.name} ${row.file}:${row.line} depth=${row.depth}${route}`;
}

function orEmpty(values: string[]): string[] {
  if (values.length === 0) return ['  (none)'];
  return values.map((value) => `  - ${value}`);
}

function capRows<T>(rows: T[]): { rows: T[]; truncated: boolean; omittedCount: number } {
  if (rows.length <= MAX_IMPACT_NODES) {
    return { rows, truncated: false, omittedCount: 0 };
  }
  return {
    rows: rows.slice(0, MAX_IMPACT_NODES),
    truncated: true,
    omittedCount: rows.length - MAX_IMPACT_NODES,
  };
}

function finalize(
  text: string,
  capped: { truncated: boolean; omittedCount: number },
): FormatResult {
  let output = text;
  if (output.length > MAX_FORMAT_CHARS) {
    output = `${output.slice(0, MAX_FORMAT_CHARS - 14)}\ntruncated: true`;
    return { text: output, truncated: true, omittedCount: capped.omittedCount };
  }
  return { text: output, truncated: capped.truncated, omittedCount: capped.omittedCount };
}
