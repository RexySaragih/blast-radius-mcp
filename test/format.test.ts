import { describe, expect, it } from 'vitest';
import {
  formatAnalyzeBlastRadius,
  formatToolError,
  type ImpactRow,
} from '../src/tools/format.js';

function rows(count: number): ImpactRow[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `Caller${index}`,
    file: `src/f${index}.ts`,
    line: index + 1,
    depth: (index % 3) + 1,
  }));
}

describe('Compact impact formatter', () => {
  describe('when formatting 20 impact rows', () => {
    it('should stay within 8000 chars and include impact_tree and direct_callers', () => {
      const result = formatAnalyzeBlastRadius({
        modifiedSymbols: ['UserService.updateEmail'],
        directCallers: 1,
        indirectCallers: 0,
        affectedRoutes: 1,
        affectedDbModels: 0,
        riskLevel: 'LOW',
        riskScore: 10,
        impactTree: rows(20),
        affectedTestFiles: ['tests/unit/user_service.test.ts'],
        unresolvedCalls: 0,
      });

      expect(result.text.length).toBeLessThanOrEqual(8000);
      expect(result.text).toContain('impact_tree');
      expect(result.text).toContain('direct_callers');
    });
  });

  describe('when formatting 101 impact rows', () => {
    it('should set truncated true and omitted_count 1', () => {
      const result = formatAnalyzeBlastRadius({
        modifiedSymbols: ['x'],
        directCallers: 101,
        indirectCallers: 0,
        affectedRoutes: 0,
        affectedDbModels: 0,
        riskLevel: 'MEDIUM',
        riskScore: 25,
        impactTree: rows(101),
        affectedTestFiles: [],
        unresolvedCalls: 0,
      });

      expect(result.truncated).toBe(true);
      expect(result.omittedCount).toBe(1);
      expect(result.text).toContain('truncated: true');
      expect(result.text).toContain('omitted_count: 1');
    });
  });

  describe('when formatting a tool error that has a stack', () => {
    it('should omit stack frames containing " at "', () => {
      const error = new Error('boom');
      error.stack = `Error: boom\n    at Object.<anonymous> (/tmp/x.ts:1:1)\n    at Module._compile (node:internal)`;
      const text = formatToolError('SYMBOL_NOT_FOUND', error.message, error);

      expect(text).toContain('SYMBOL_NOT_FOUND');
      expect(text).not.toMatch(/\sat\s/);
    });
  });
});
