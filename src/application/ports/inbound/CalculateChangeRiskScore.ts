import type { RiskLevel } from '../../../domain/Risk.js';

export type CalculateChangeRiskScoreInput = {
  target_branch?: string;
};

export type RiskScoreOutput = {
  risk_score: number;
  risk_level: RiskLevel;
  depth_points: number;
  api_points: number;
  test_gap_points: number;
  forgotten_points: number;
};

export interface CalculateChangeRiskScore {
  execute(input: CalculateChangeRiskScoreInput): Promise<RiskScoreOutput>;
}
