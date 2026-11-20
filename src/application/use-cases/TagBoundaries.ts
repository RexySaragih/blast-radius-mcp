import { tagTypescriptBoundaries } from '../../languages/boundaries-typescript.js';
import type { Edge } from '../../domain/Edge.js';
import type { SymbolNode } from '../../domain/Symbol.js';

export type TagBoundariesInput = {
  filePath: string;
  source: string;
  symbols: SymbolNode[];
  edges: Edge[];
};

export type TagBoundariesOutput = {
  symbols: SymbolNode[];
  edges: Edge[];
};

export class TagBoundaries {
  execute(input: TagBoundariesInput): TagBoundariesOutput {
    if (/\.(sql|prisma|ts|tsx|js|jsx|mts|cts|mjs|cjs)$/iu.test(input.filePath)) {
      return tagTypescriptBoundaries(input.source, input.filePath, input.symbols, input.edges);
    }
    return { symbols: input.symbols, edges: input.edges };
  }
}
