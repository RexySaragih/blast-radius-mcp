import { beforeAll, describe, expect, it } from 'vitest';
import { ExtractSymbols } from '../src/application/use-cases/ExtractSymbols.js';
import { LinkSymbols } from '../src/application/use-cases/LinkSymbols.js';
import { TreeSitterParser } from '../src/clients/treesitter-client.js';

describe('Link Symbols', () => {
  let extract: ExtractSymbols;
  let link: LinkSymbols;

  beforeAll(async () => {
    extract = new ExtractSymbols(await TreeSitterParser.create());
    link = new LinkSymbols();
  });

  describe('when function b calls function a in the same file', () => {
    it('should create one calls edge from b to a', () => {
      const parse = extract.execute({
        filePath: 'src/same.ts',
        source: `
function a() { return 1; }
function b() { return a(); }
`,
      });
      const result = link.execute({ parses: [parse] });
      const a = parse.symbols.find((symbol) => symbol.name === 'a');
      const b = parse.symbols.find((symbol) => symbol.name === 'b');
      const calls = result.edges.filter((edge) => edge.type === 'calls');

      expect(a).toBeDefined();
      expect(b).toBeDefined();
      expect(calls).toHaveLength(1);
      expect(calls[0]?.sourceId).toBe(b?.id);
      expect(calls[0]?.targetId).toBe(a?.id);
    });
  });

  describe('when a relative import of a named function is called', () => {
    it('should create a calls edge targeting the imported symbol', () => {
      const fileA = extract.execute({
        filePath: 'src/a.ts',
        source: `export function a() { return 1; }\n`,
      });
      const fileB = extract.execute({
        filePath: 'src/b.ts',
        source: `
import { a } from './a.js';
function b() { return a(); }
`,
      });
      const result = link.execute({ parses: [fileA, fileB] });
      const a = fileA.symbols.find((symbol) => symbol.name === 'a');
      const b = fileB.symbols.find((symbol) => symbol.name === 'b');
      const calls = result.edges.filter((edge) => edge.type === 'calls');

      expect(calls.some((edge) => edge.sourceId === b?.id && edge.targetId === a?.id)).toBe(true);
    });
  });

  describe('when a call goes through obj[name]()', () => {
    it('should count one unresolved call and invent no edge target', () => {
      const parse = extract.execute({
        filePath: 'src/dyn.ts',
        source: `
function runner() {
  obj[name]();
}
`,
      });
      const result = link.execute({ parses: [parse] });

      expect(result.unresolvedCalls).toBe(1);
      expect(result.edges.filter((edge) => edge.type === 'calls')).toHaveLength(0);
    });
  });
});
