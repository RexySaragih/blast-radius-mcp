export type MigrationFinding = 'REWRITE' | 'LOCK_WRITES' | 'CDC_BREAK' | 'INDEX_GAP';

export type SimulateMigrationInput = {
  migration_file_path: string;
};

export type MigrationImpactOutput = {
  lock_risk: 'HIGH' | 'LOW';
  findings: MigrationFinding[];
};

export interface SimulateMigrationLockImpact {
  execute(input: SimulateMigrationInput): Promise<MigrationImpactOutput>;
}
