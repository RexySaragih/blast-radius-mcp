import type { Edge } from '../../../domain/Edge.js';
import type { SymbolNode } from '../../../domain/Symbol.js';

export type RawRef = {
  kind: 'call' | 'import' | 'implements' | 'publish' | 'query';
  name: string;
  fromSymbolId: string | null;
  sourceFile: string;
  targetFile: string | null;
  importedNames: string[];
  dynamic: boolean;
  line: number;
  column: number;
};

export type ParseResult = {
  symbols: SymbolNode[];
  edges: Edge[];
  unresolvedRefCount: number;
  rawRefs: RawRef[];
  language: string;
};

export interface SourceParserPort {
  parse(filePath: string, source: string): ParseResult;
  supportedLanguages(): string[];
}
