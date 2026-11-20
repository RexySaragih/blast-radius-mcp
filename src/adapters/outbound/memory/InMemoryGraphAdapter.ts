import type { Edge } from '../../../domain/Edge.js';
import type { SymbolNode } from '../../../domain/Symbol.js';
import type {
  FileIndexRow,
  GraphStorePort,
  TestCaseRef,
} from '../../../application/ports/outbound/GraphStorePort.js';

export class InMemoryGraphAdapter implements GraphStorePort {
  private readonly nodes = new Map<string, SymbolNode>();
  private readonly edges = new Map<string, Edge>();
  private readonly hashes = new Map<string, FileIndexRow>();

  replaceFile(filePath: string, symbols: SymbolNode[], edges: Edge[]): void {
    for (const [id, node] of this.nodes) {
      if (node.filePath === filePath) this.nodes.delete(id);
    }
    for (const [id, edge] of this.edges) {
      const source = this.nodes.get(edge.sourceId);
      const target = this.nodes.get(edge.targetId);
      if (!source || !target || source.filePath === filePath || target.filePath === filePath) {
        this.edges.delete(id);
      }
    }
    for (const symbol of symbols) this.nodes.set(symbol.id, symbol);
    for (const edge of edges) this.edges.set(edge.id, edge);
  }

  seed(symbols: SymbolNode[], edges: Edge[]): void {
    for (const symbol of symbols) this.nodes.set(symbol.id, symbol);
    for (const edge of edges) this.edges.set(edge.id, edge);
  }

  getNode(symbolId: string): SymbolNode | null {
    return this.nodes.get(symbolId) ?? null;
  }

  findByQualifiedName(filePath: string, name: string): SymbolNode | null {
    for (const node of this.nodes.values()) {
      if (node.filePath === filePath && node.name === name) return node;
    }
    return null;
  }

  findByName(name: string): SymbolNode[] {
    return [...this.nodes.values()].filter((node) => node.name === name);
  }

  getIncomingEdges(symbolId: string): Edge[] {
    return [...this.edges.values()].filter((edge) => edge.targetId === symbolId);
  }

  getOutgoingEdges(symbolId: string): Edge[] {
    return [...this.edges.values()].filter((edge) => edge.sourceId === symbolId);
  }

  listByFile(filePath: string): SymbolNode[] {
    return [...this.nodes.values()].filter((node) => node.filePath === filePath);
  }

  listSymbols(): SymbolNode[] {
    return [...this.nodes.values()];
  }

  listEdges(): Edge[] {
    return [...this.edges.values()];
  }

  listTestCases(runner: string): TestCaseRef[] {
    return [...this.nodes.values()]
      .filter((node) => node.kind === 'test' && (runner === '*' || node.language === runner))
      .map((node) => ({
        symbolId: node.id,
        name: node.name,
        filePath: node.filePath,
        runner,
      }));
  }

  fileContentHash(filePath: string): string | null {
    return this.hashes.get(filePath)?.contentHash ?? null;
  }

  setFileHash(filePath: string, contentHash: string): void {
    this.hashes.set(filePath, {
      filePath,
      contentHash,
      indexedAt: new Date().toISOString(),
    });
  }

  listIndexedFiles(): FileIndexRow[] {
    return [...this.hashes.values()];
  }
}
