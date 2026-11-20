import { ApplicationError } from '../errors.js';
import type {
  MigrationFinding,
  MigrationImpactOutput,
  SimulateMigrationInput,
  SimulateMigrationLockImpact,
} from '../ports/inbound/SimulateMigrationLockImpact.js';
import type { WorkspacePort } from '../ports/outbound/WorkspacePort.js';

export class SimulateMigrationLockImpactUseCase implements SimulateMigrationLockImpact {
  constructor(private readonly workspace: WorkspacePort) {}

  async execute(input: SimulateMigrationInput): Promise<MigrationImpactOutput> {
    const abs = this.workspace.resolveInsideRoot(input.migration_file_path);
    const relative = this.workspace.relativePath(abs);
    if (!this.workspace.exists(relative)) {
      throw new ApplicationError('INVALID', 'migration_file_path');
    }
    const source = this.workspace.readText(relative);
    const findings = analyzeMigration(source);
    const lock_risk =
      findings.includes('REWRITE') || findings.includes('LOCK_WRITES') || findings.includes('CDC_BREAK')
        ? 'HIGH'
        : 'LOW';
    return { lock_risk, findings };
  }
}

export function analyzeMigration(source: string): MigrationFinding[] {
  const findings: MigrationFinding[] = [];
  const upper = source.toUpperCase();

  if (
    /ALTER\s+COLUMN[\s\S]*?\bTYPE\b/i.test(source) ||
    (/SET\s+NOT\s+NULL/i.test(source) && !/SET\s+NOT\s+NULL[\s\S]{0,80}DEFAULT/i.test(source)) ||
    /ADD\s+COLUMN[\s\S]*DEFAULT\s+\w+\(/i.test(source)
  ) {
    findings.push('REWRITE');
  }

  if (/CREATE\s+(UNIQUE\s+)?INDEX/i.test(source) && !/CONCURRENTLY/i.test(source)) {
    findings.push('LOCK_WRITES');
  }

  if (/DROP\s+COLUMN|RENAME\s+COLUMN|RENAME\s+TABLE|DROP\s+TABLE/i.test(source)) {
    findings.push('CDC_BREAK');
  }

  const indexedColumns = indexColumnNames(source);
  const fkColumns = [...source.matchAll(/FOREIGN\s+KEY\s*\(\s*(\w+)\s*\)/gi)].map((match) =>
    match[1]?.toLowerCase(),
  );
  for (const column of fkColumns) {
    if (!column) continue;
    if (!indexedColumns.has(column)) findings.push('INDEX_GAP');
  }

  void upper;
  return [...new Set(findings)];
}

function indexColumnNames(source: string): Set<string> {
  const columns = new Set<string>();
  for (const match of source.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\b[^;]*\(([^)]*)\)/gi)) {
    for (const raw of (match[1] ?? '').split(',')) {
      const name = raw.trim().replace(/["`]/g, '').split(/\s+/)[0]?.toLowerCase();
      if (name) columns.add(name);
    }
  }
  return columns;
}
