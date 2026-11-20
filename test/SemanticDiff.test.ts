import { beforeAll, describe, expect, it } from 'vitest';
import { ExtractSymbols } from '../src/application/use-cases/ExtractSymbols.js';
import { SemanticDiff } from '../src/application/use-cases/SemanticDiff.js';
import { TreeSitterParser } from '../src/clients/treesitter-client.js';

describe('Semantic Diff', () => {
  let extract: ExtractSymbols;
  let diff: SemanticDiff;

  beforeAll(async () => {
    extract = new ExtractSymbols(await TreeSitterParser.create());
    diff = new SemanticDiff();
  });

  describe('when a diff only changes spaces in a function', () => {
    it('should leave modified_symbols empty', () => {
      const before = extract.execute({
        filePath: 'src/fn.ts',
        source: `export function run(a: number) { return a; }\n`,
      });
      const after = extract.execute({
        filePath: 'src/fn.ts',
        source: `export function run(a: number) {\n\n  return a;\n}\n`,
      });

      const result = diff.execute({ before, after });
      expect(result.modifiedSymbols).toEqual([]);
    });
  });

  describe('when a parameter list changes', () => {
    it('should classify the symbol as signature_modified', () => {
      const before = extract.execute({
        filePath: 'src/fn.ts',
        source: `export function run(a: number) { return a; }\n`,
      });
      const after = extract.execute({
        filePath: 'src/fn.ts',
        source: `export function run(a: number, b: number) { return a + b; }\n`,
      });

      const result = diff.execute({ before, after });
      expect(result.modifiedSymbols).toHaveLength(1);
      expect(result.modifiedSymbols[0]?.kind).toBe('signature_modified');
      expect(result.modifiedSymbols[0]?.symbol.name).toBe('run');
    });
  });

  describe('when a function is added and another is removed', () => {
    it('should classify kinds as added and removed', () => {
      const before = extract.execute({
        filePath: 'src/fn.ts',
        source: `export function oldFn() { return 1; }\n`,
      });
      const after = extract.execute({
        filePath: 'src/fn.ts',
        source: `export function newFn() { return 2; }\n`,
      });

      const result = diff.execute({ before, after });
      const kinds = result.modifiedSymbols.map((change) => change.kind).sort();
      expect(kinds).toEqual(['added', 'removed']);
    });
  });
});
