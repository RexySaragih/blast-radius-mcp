import { describe, expect, it } from 'vitest';
import { scoreFromFactors } from '../src/application/use-cases/CalculateChangeRiskScore.js';
import { formatRiskScore } from '../src/tools/format.js';

describe('Calculate Change Risk Score', () => {
  describe('when scoring a typical change', () => {
    it('should return an integer risk_score 0..100 with four factor fields', () => {
      const result = scoreFromFactors({
        deepestImpactDepth: 3,
        alteredBoundaryRouteCount: 1,
        hasTestGap: false,
        hasForgotten: false,
      });
      const text = formatRiskScore({
        riskScore: result.risk_score,
        riskLevel: result.risk_level,
        depthPoints: result.depth_points,
        apiPoints: result.api_points,
        testGapPoints: result.test_gap_points,
        forgottenPoints: result.forgotten_points,
      });
      expect(result.risk_score).toBeGreaterThanOrEqual(0);
      expect(result.risk_score).toBeLessThanOrEqual(100);
      expect(Number.isInteger(result.risk_score)).toBe(true);
      expect(text).toContain('depth_points');
      expect(text).toContain('api_points');
      expect(text).toContain('test_gap_points');
      expect(text).toContain('forgotten_points');
    });
  });

  describe('when 10 altered boundary routes are the only factor', () => {
    it('should cap api_points at 25 and risk_score at most 100', () => {
      const result = scoreFromFactors({
        deepestImpactDepth: 2,
        alteredBoundaryRouteCount: 10,
        hasTestGap: false,
        hasForgotten: false,
      });
      expect(result.api_points).toBe(25);
      expect(result.risk_score).toBeLessThanOrEqual(100);
    });
  });

  describe('when deepest impact depth is 2 with no other factors', () => {
    it('should set depth_points to 0', () => {
      const result = scoreFromFactors({
        deepestImpactDepth: 2,
        alteredBoundaryRouteCount: 0,
        hasTestGap: false,
        hasForgotten: false,
      });
      expect(result.depth_points).toBe(0);
    });
  });
});
