import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Limits } from '../src/domain/Limits.js';
import { makeSymbolId } from '../src/domain/Symbol.js';

describe('Named limits', () => {
  describe('when the constants are read', () => {
    it('should expose the section 5 depth, diff, and co-change values', () => {
      expect(Limits.DEFAULT_MAX_DEPTH).toBe(3);
      expect(Limits.HARD_MAX_DEPTH).toBe(10);
      expect(Limits.MAX_DIFF_CHARS).toBe(200000);
      expect(Limits.COCHANGE_MIN_SUPPORT).toBe(5);
      expect(Limits.COCHANGE_DEFAULT_CONFIDENCE).toBe(0.7);
    });
  });
});

describe('Symbol identity', () => {
  describe('when the same file, name, line, and column are hashed twice', () => {
    it('should match sha256 of a.ts:Foo.bar:10:2 and match each other', () => {
      const first = makeSymbolId('a.ts', 'Foo.bar', 10, 2);
      const second = makeSymbolId('a.ts', 'Foo.bar', 10, 2);
      const expected = createHash('sha256').update('a.ts:Foo.bar:10:2').digest('hex');
      expect(first).toBe(expected);
      expect(second).toBe(expected);
      expect(first).toBe(second);
    });
  });
});
