import type { RiskLevel } from '../../../domain/Risk.js';

export type AnalyzeBlastRadiusInput = {
  diff: string;
  max_depth: number;
  include_tests: boolean;
};

export type ChangeKind = 'added' | 'removed' | 'signature_modified' | 'body_modified';

export type ModifiedSymbol = {
  name: string;
  file: string;
  change: ChangeKind;
};

export type ImpactRow = {
  name: string;
  file: string;
  line: number;
  depth: number;
  kind: string;
  is_boundary: boolean;
  route_label: string | null;
};

export type BlastRadiusOutput = {
  modified_symbols: ModifiedSymbol[];
  impact_summary: {
    direct_callers: number;
    indirect_callers: number;
    affected_routes: number;
    affected_db_models: number;
    risk_level: RiskLevel;
    risk_score: number;
  };
  impact_tree: ImpactRow[];
  affected_test_files: string[];
  unresolved_calls: number;
  truncated: boolean;
  omitted_count: number;
};

export interface AnalyzeBlastRadius {
  execute(input: AnalyzeBlastRadiusInput): Promise<BlastRadiusOutput>;
}
