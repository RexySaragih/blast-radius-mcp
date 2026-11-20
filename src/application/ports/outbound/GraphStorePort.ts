import type { Edge } from '../../../domain/Edge.js';
import type { SymbolNode } from '../../../domain/Symbol.js';

export type TestCaseRef = {
  symbolId: string;
  name: string;
  filePath: string;
  runner: string;
};

export type FileIndexRow = {
  filePath: string;
  contentHash: string;
  indexedAt: string;
};

export interface GraphStorePort {
  replaceFile(filePath: string, symbols: SymbolNode[], edges: Edge[]): void;
  getNode(symbolId: string): SymbolNode | null;
  findByQualifiedName(filePath: string, name: string): SymbolNode | null;
  findByName(name: string): SymbolNode[];
  getIncomingEdges(symbolId: string): Edge[];
  getOutgoingEdges(symbolId: string): Edge[];
  listByFile(filePath: string): SymbolNode[];
  listSymbols(): SymbolNode[];
  listEdges(): Edge[];
  listTestCases(runner: string): TestCaseRef[];
  fileContentHash(filePath: string): string | null;
  setFileHash(filePath: string, contentHash: string): void;
  listIndexedFiles(): FileIndexRow[];
  databasePath?(): string;
}
