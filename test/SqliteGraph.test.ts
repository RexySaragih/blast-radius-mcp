import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteGraphAdapter } from '../src/clients/sqlite-graph-client.js';
import { SQLITE_BUSY_TIMEOUT_MS } from '../src/domain/Limits.js';
import { createEdge } from '../src/domain/Edge.js';
import { createSymbol } from '../src/domain/Symbol.js';

const VALIDATE_SENTINEL = 'VALIDATE_SENTINEL';
const openAdapters: SqliteGraphAdapter[] = [];

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'blast-radius-sqlite-'));
}

function openGraph(root: string): SqliteGraphAdapter {
  const graph = new SqliteGraphAdapter(root);
  openAdapters.push(graph);
  return graph;
}

afterEach(() => {
  while (openAdapters.length > 0) {
    openAdapters.pop()?.close();
  }
});

describe('SQLite WAL graph adapter', () => {
  describe('when the adapter opens on a temp root', () => {
    it('should create .mcp/blast_radius.db in WAL mode', () => {
      const root = tempRoot();
      const graph = openGraph(root);

      expect(graph.databasePath()).toBe(path.join(root, '.mcp', 'blast_radius.db'));
      expect(fs.existsSync(graph.databasePath())).toBe(true);
      expect(graph.journalMode().toLowerCase()).toBe('wal');
      expect(graph.busyTimeoutMs()).toBe(SQLITE_BUSY_TIMEOUT_MS);
    });
  });

  describe('when another connection holds the database lock', () => {
    it('should write after the lock is released', async () => {
      const root = tempRoot();
      const mcpDir = path.join(root, '.mcp');
      fs.mkdirSync(mcpDir, { recursive: true });
      const dbPath = path.join(mcpDir, 'blast_radius.db');
      const holder = spawn(process.execPath, [
        '--input-type=module',
        '-e',
        "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(process.argv[1]); db.exec('BEGIN EXCLUSIVE'); setTimeout(() => { db.exec('COMMIT'); db.close(); }, 300);",
        dbPath,
      ]);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const graph = new SqliteGraphAdapter(root, 30_000, 2_000);
      openAdapters.push(graph);
      const symbol = createSymbol({
        name: 'check',
        kind: 'function',
        filePath: 'src/check.ts',
        startLine: 1,
        startColumn: 0,
        endLine: 2,
        endColumn: 1,
        hash: 'hash-check',
        signatureHash: 'sig-check',
        bodyHash: 'body-check',
        isBoundary: false,
        language: 'typescript',
      });

      graph.replaceFile(symbol.filePath, [symbol], []);

      expect(graph.getNode(symbol.id)?.name).toBe('check');
      await new Promise((resolve) => holder.on('exit', resolve));
    });
  });

  describe('when a symbol and calls edge are written then reopened', () => {
    it('should round-trip ids, kinds, and edge type through a new connection', () => {
      const root = tempRoot();
      const filePath = 'src/auth.ts';
      const callee = createSymbol({
        name: 'validateSession',
        kind: 'function',
        filePath,
        startLine: 10,
        startColumn: 2,
        endLine: 20,
        endColumn: 1,
        hash: 'hash-validate',
        signatureHash: 'sig-validate',
        bodyHash: 'body-validate',
        isBoundary: false,
        language: 'typescript',
      });
      const caller = createSymbol({
        name: 'loginHandler',
        kind: 'route',
        filePath,
        startLine: 30,
        startColumn: 2,
        endLine: 40,
        endColumn: 1,
        hash: 'hash-login',
        signatureHash: 'sig-login',
        bodyHash: 'body-login',
        isBoundary: true,
        language: 'typescript',
      });
      const edge = createEdge(caller.id, 'calls', callee.id);

      const writer = openGraph(root);
      writer.replaceFile(filePath, [callee, caller], [edge]);
      writer.close();
      openAdapters.pop();

      const reader = openGraph(root);
      const loadedCallee = reader.getNode(callee.id);
      const loadedCaller = reader.getNode(caller.id);
      const incoming = reader.getIncomingEdges(callee.id);

      expect(loadedCallee?.id).toBe(callee.id);
      expect(loadedCallee?.kind).toBe('function');
      expect(loadedCaller?.id).toBe(caller.id);
      expect(loadedCaller?.kind).toBe('route');
      expect(incoming).toHaveLength(1);
      expect(incoming[0]?.id).toBe(edge.id);
      expect(incoming[0]?.type).toBe('calls');
      expect(incoming[0]?.sourceId).toBe(caller.id);
      expect(incoming[0]?.targetId).toBe(callee.id);
    });
  });

  describe('when replaceFile writes symbols derived from source containing a sentinel', () => {
    it('should keep VALIDATE_SENTINEL out of the sqlite file bytes', () => {
      const root = tempRoot();
      const source = [
        'export function check() {',
        `  return '${VALIDATE_SENTINEL}';`,
        '}',
      ].join('\n');
      expect(source).toContain(VALIDATE_SENTINEL);

      const symbol = createSymbol({
        name: 'check',
        kind: 'function',
        filePath: 'src/check.ts',
        startLine: 1,
        startColumn: 1,
        endLine: 3,
        endColumn: 1,
        hash: 'semantic-without-source',
        signatureHash: 'sig-check',
        bodyHash: 'body-check',
        isBoundary: false,
        language: 'typescript',
      });

      const graph = openGraph(root);
      graph.replaceFile(symbol.filePath, [symbol], []);
      graph.close();
      openAdapters.pop();

      const dbBytes = fs.readFileSync(graph.databasePath(), 'utf8');
      expect(dbBytes).not.toContain(VALIDATE_SENTINEL);
      expect(dbBytes).not.toContain(source);
    });
  });
});
