import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { FileIndexRow, GraphStorePort, TestCaseRef } from '../application/ports/outbound/GraphStorePort.js';
import type { Edge, EdgeType } from '../domain/Edge.js';
import type { SymbolKind, SymbolNode } from '../domain/Symbol.js';
import { matchesRunner } from '../domain/testFiles.js';
import { SQLITE_BUSY_TIMEOUT_MS } from '../domain/Limits.js';
import { BaseClient } from './base-client.js';

type SymbolRow = {
  symbol_id: string;
  name: string;
  kind: string;
  file_path: string;
  start_line: number;
  start_col: number;
  end_line: number;
  end_col: number;
  hash: string;
  is_boundary: number;
  language: string;
  route_label: string | null;
};

type EdgeRow = {
  edge_id: string;
  source_id: string;
  target_id: string;
  type: string;
};

type FileRow = {
  file_path: string;
  content_hash: string;
  indexed_at: string;
};

export function toDomain(row: SymbolRow): SymbolNode {
  return {
    id: row.symbol_id,
    name: row.name,
    kind: row.kind as SymbolKind,
    filePath: row.file_path,
    startLine: Number(row.start_line),
    startColumn: Number(row.start_col),
    endLine: Number(row.end_line),
    endColumn: Number(row.end_col),
    hash: row.hash,
    signatureHash: row.hash,
    bodyHash: row.hash,
    isBoundary: Number(row.is_boundary) === 1,
    language: row.language,
    routeLabel: row.route_label ?? null,
  };
}

export function toRow(symbol: SymbolNode): SymbolRow {
  return {
    symbol_id: symbol.id,
    name: symbol.name,
    kind: symbol.kind,
    file_path: symbol.filePath,
    start_line: symbol.startLine,
    start_col: symbol.startColumn,
    end_line: symbol.endLine,
    end_col: symbol.endColumn,
    hash: symbol.hash,
    is_boundary: symbol.isBoundary ? 1 : 0,
    language: symbol.language,
    route_label: symbol.routeLabel,
  };
}

export function edgeToRow(edge: Edge): EdgeRow {
  return {
    edge_id: edge.id,
    source_id: edge.sourceId,
    target_id: edge.targetId,
    type: edge.type,
  };
}

export function edgeToDomain(row: EdgeRow): Edge {
  return {
    id: row.edge_id,
    sourceId: row.source_id,
    targetId: row.target_id,
    type: row.type as EdgeType,
  };
}

export class SqliteGraphAdapter extends BaseClient implements GraphStorePort {
  private readonly db: DatabaseSync;
  private readonly dbPath: string;

  constructor(root: string, timeoutMs = 30_000, busyTimeoutMs = SQLITE_BUSY_TIMEOUT_MS) {
    super({ timeoutMs });
    const mcpDir = path.join(root, '.mcp');
    fs.mkdirSync(mcpDir, { recursive: true });
    this.dbPath = path.join(mcpDir, 'blast_radius.db');
    this.db = new DatabaseSync(this.dbPath, { timeout: busyTimeoutMs });
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS symbols (
        symbol_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        file_path TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        start_col INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        end_col INTEGER NOT NULL,
        hash TEXT NOT NULL,
        is_boundary INTEGER NOT NULL,
        language TEXT NOT NULL,
        route_label TEXT
      );
      CREATE TABLE IF NOT EXISTS edges (
        edge_id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        type TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS file_index (
        file_path TEXT PRIMARY KEY,
        content_hash TEXT NOT NULL,
        indexed_at TEXT NOT NULL
      );
    `);
    const columns = this.db.prepare('PRAGMA table_info(symbols)').all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'route_label')) {
      this.db.exec('ALTER TABLE symbols ADD COLUMN route_label TEXT');
    }
  }

  databasePath(): string {
    return this.dbPath;
  }

  journalMode(): string {
    const row = this.db.prepare('PRAGMA journal_mode').get() as { journal_mode?: string } | undefined;
    return String(row?.journal_mode ?? '');
  }

  busyTimeoutMs(): number {
    const row = this.db.prepare('PRAGMA busy_timeout').get() as { timeout?: number } | undefined;
    return Number(row?.timeout ?? 0);
  }

  close(): void {
    this.db.close();
  }

  replaceFile(filePath: string, symbols: SymbolNode[], edges: Edge[]): void {
    const existing = this.listByFile(filePath);
    const ids = existing.map((node) => node.id);
    this.db.exec('BEGIN');
    try {
      for (const id of ids) {
        this.db.prepare('DELETE FROM edges WHERE source_id = ? OR target_id = ?').run(id, id);
      }
      this.db.prepare('DELETE FROM symbols WHERE file_path = ?').run(filePath);
      const insertSymbol = this.db.prepare(
        `INSERT INTO symbols (
          symbol_id, name, kind, file_path, start_line, start_col, end_line, end_col, hash, is_boundary, language, route_label
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const symbol of symbols) {
        const row = toRow(symbol);
        insertSymbol.run(
          row.symbol_id,
          row.name,
          row.kind,
          row.file_path,
          row.start_line,
          row.start_col,
          row.end_line,
          row.end_col,
          row.hash,
          row.is_boundary,
          row.language,
          row.route_label,
        );
      }
      const insertEdge = this.db.prepare(
        'INSERT OR REPLACE INTO edges (edge_id, source_id, target_id, type) VALUES (?, ?, ?, ?)',
      );
      for (const edge of edges) {
        const row = edgeToRow(edge);
        insertEdge.run(row.edge_id, row.source_id, row.target_id, row.type);
      }
      this.db.exec('COMMIT');
    } catch (error: unknown) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // The lock holder may already have ended the transaction.
      }
      throw error;
    }
  }

  getNode(symbolId: string): SymbolNode | null {
    const row = this.db.prepare('SELECT * FROM symbols WHERE symbol_id = ?').get(symbolId) as SymbolRow | undefined;
    return row ? toDomain(row) : null;
  }

  findByQualifiedName(filePath: string, name: string): SymbolNode | null {
    const row = this.db
      .prepare('SELECT * FROM symbols WHERE file_path = ? AND name = ?')
      .get(filePath, name) as SymbolRow | undefined;
    return row ? toDomain(row) : null;
  }

  findByName(name: string): SymbolNode[] {
    const rows = this.db
      .prepare('SELECT * FROM symbols WHERE name = ? OR name LIKE ?')
      .all(name, `%.${name}`) as SymbolRow[];
    return rows.map(toDomain);
  }

  getIncomingEdges(symbolId: string): Edge[] {
    const rows = this.db.prepare('SELECT * FROM edges WHERE target_id = ?').all(symbolId) as EdgeRow[];
    return rows.map(edgeToDomain);
  }

  getOutgoingEdges(symbolId: string): Edge[] {
    const rows = this.db.prepare('SELECT * FROM edges WHERE source_id = ?').all(symbolId) as EdgeRow[];
    return rows.map(edgeToDomain);
  }

  listByFile(filePath: string): SymbolNode[] {
    const rows = this.db.prepare('SELECT * FROM symbols WHERE file_path = ?').all(filePath) as SymbolRow[];
    return rows.map(toDomain);
  }

  listSymbols(): SymbolNode[] {
    const rows = this.db.prepare('SELECT * FROM symbols').all() as SymbolRow[];
    return rows.map(toDomain);
  }

  listEdges(): Edge[] {
    const rows = this.db.prepare('SELECT * FROM edges').all() as EdgeRow[];
    return rows.map(edgeToDomain);
  }

  listTestCases(runner: string): TestCaseRef[] {
    return this.listSymbols()
      .filter(
        (node) =>
          node.kind === 'test' && (runner === '*' || matchesRunner(node.filePath, runner)),
      )
      .map((node) => ({
        symbolId: node.id,
        name: node.name,
        filePath: node.filePath,
        runner,
      }));
  }

  fileContentHash(filePath: string): string | null {
    const row = this.db.prepare('SELECT content_hash FROM file_index WHERE file_path = ?').get(filePath) as
      | { content_hash: string }
      | undefined;
    return row?.content_hash ?? null;
  }

  setFileHash(filePath: string, contentHash: string): void {
    this.db
      .prepare(
        'INSERT INTO file_index (file_path, content_hash, indexed_at) VALUES (?, ?, ?) ON CONFLICT(file_path) DO UPDATE SET content_hash = excluded.content_hash, indexed_at = excluded.indexed_at',
      )
      .run(filePath, contentHash, new Date().toISOString());
  }

  listIndexedFiles(): FileIndexRow[] {
    const rows = this.db.prepare('SELECT * FROM file_index').all() as FileRow[];
    return rows.map((row) => ({
      filePath: row.file_path,
      contentHash: row.content_hash,
      indexedAt: row.indexed_at,
    }));
  }
}
