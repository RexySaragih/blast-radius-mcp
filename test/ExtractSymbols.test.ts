import { beforeAll, describe, expect, it } from 'vitest';
import { ExtractSymbols } from '../src/application/use-cases/ExtractSymbols.js';
import { TreeSitterParser } from '../src/clients/treesitter-client.js';

describe('Extract Symbols', () => {
  let extract: ExtractSymbols;

  beforeAll(async () => {
    extract = new ExtractSymbols(await TreeSitterParser.create());
  });

  describe('when a TypeScript class method is extracted', () => {
    it('should name the symbol UserService.updateEmail with language typescript', () => {
      const source = `
class UserService {
  updateEmail(email: string) {
    return email;
  }
}
`;
      const result = extract.execute({ filePath: 'src/user-service.ts', source });
      const method = result.symbols.find((symbol) => symbol.name === 'UserService.updateEmail');

      expect(method).toBeDefined();
      expect(method?.language).toBe('typescript');
      expect(result.language).toBe('typescript');
    });
  });

  describe('when the same method gains a comment and whitespace', () => {
    it('should keep the semantic hash unchanged', () => {
      const original = `
class UserService {
  updateEmail(email: string) {
    return email;
  }
}
`;
      const commented = `
class UserService {
  // reshaped spacing
  updateEmail(email: string) {


    return email; // trailing note
  }
}
`;
      const before = extract.execute({ filePath: 'src/user-service.ts', source: original });
      const after = extract.execute({ filePath: 'src/user-service.ts', source: commented });
      const beforeMethod = before.symbols.find((symbol) => symbol.name === 'UserService.updateEmail');
      const afterMethod = after.symbols.find((symbol) => symbol.name === 'UserService.updateEmail');

      expect(beforeMethod?.hash).toBeDefined();
      expect(afterMethod?.hash).toBe(beforeMethod?.hash);
    });
  });

  describe('when a .tsx file and a .js file each export one function', () => {
    it('should yield one function symbol from each file', () => {
      const tsx = extract.execute({
        filePath: 'src/Hello.tsx',
        source: 'export function Hello() { return <div />; }\n',
      });
      const js = extract.execute({
        filePath: 'src/greet.js',
        source: 'export function greet() { return 1; }\n',
      });

      expect(tsx.symbols.filter((symbol) => symbol.kind === 'function')).toHaveLength(1);
      expect(tsx.symbols[0]?.name).toBe('Hello');
      expect(tsx.language).toBe('tsx');
      expect(js.symbols.filter((symbol) => symbol.kind === 'function')).toHaveLength(1);
      expect(js.symbols[0]?.name).toBe('greet');
      expect(js.language).toBe('javascript');
    });
  });
});
