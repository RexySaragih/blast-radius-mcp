import {
  RISK_API_CAP,
  RISK_API_STEP,
  RISK_CRITICAL_MIN,
  RISK_DEPTH_CAP,
  RISK_DEPTH_FREE_LAYERS,
  RISK_DEPTH_STEP,
  RISK_FORGOTTEN_POINTS,
  RISK_HIGH_MIN,
  RISK_MEDIUM_MIN,
  RISK_TEST_GAP_POINTS,
} from './Limits.js';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type RiskBreakdown = {
  depth_points: number;
  api_points: number;
  test_gap_points: number;
  forgotten_points: number;
  risk_score: number;
  risk_level: RiskLevel;
};

export function clampRisk(score: number): number {
  if (score < 0) return 0;
  if (score > 100) return 100;
  return Math.round(score);
}

export function riskBand(score: number): RiskLevel {
  const clamped = clampRisk(score);
  if (clamped >= RISK_CRITICAL_MIN) return 'CRITICAL';
  if (clamped >= RISK_HIGH_MIN) return 'HIGH';
  if (clamped >= RISK_MEDIUM_MIN) return 'MEDIUM';
  return 'LOW';
}

export function depthPoints(deepestImpactDepth: number): number {
  return Math.min(RISK_DEPTH_CAP, RISK_DEPTH_STEP * Math.max(0, deepestImpactDepth - RISK_DEPTH_FREE_LAYERS));
}

export function apiPoints(alteredBoundaryRouteCount: number): number {
  return Math.min(RISK_API_CAP, RISK_API_STEP * alteredBoundaryRouteCount);
}

export function computeRisk(input: {
  deepestImpactDepth: number;
  alteredBoundaryRouteCount: number;
  hasTestGap: boolean;
  hasForgotten: boolean;
}): RiskBreakdown {
  const depth_points = depthPoints(input.deepestImpactDepth);
  const api_points = apiPoints(input.alteredBoundaryRouteCount);
  const test_gap_points = input.hasTestGap ? RISK_TEST_GAP_POINTS : 0;
  const forgotten_points = input.hasForgotten ? RISK_FORGOTTEN_POINTS : 0;
  const risk_score = clampRisk(depth_points + api_points + test_gap_points + forgotten_points);
  return {
    depth_points,
    api_points,
    test_gap_points,
    forgotten_points,
    risk_score,
    risk_level: riskBand(risk_score),
  };
}
