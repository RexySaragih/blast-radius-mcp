import fs from 'node:fs';
import path from 'node:path';
import { ApplicationError } from '../application/errors.js';
import type { WorkspacePort } from '../application/ports/outbound/WorkspacePort.js';
import { IGNORE_DIR_NAMES, MAX_FILE_BYTES, WATCH_DEBOUNCE_MS } from '../domain/Limits.js';
import { SOURCE_EXT, isIgnored } from '../domain/sourceFiles.js';
import { BaseClient } from './base-client.js';

export function createDebouncedPathFlush(
  delayMs: number,
  onFlush: (paths: string[]) => void,
): { push: (relativePath: string) => void; cancel: () => void } {
  const pending = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  return {
    push(relativePath: string) {
      pending.add(relativePath);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const paths = [...pending];
        pending.clear();
        timer = null;
        onFlush(paths);
      }, delayMs);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending.clear();
    },
  };
}

export class WorkspaceFiles extends BaseClient implements WorkspacePort {
  readonly root: string;
  private watcher: fs.FSWatcher | null = null;
  private flushCancel: (() => void) | null = null;

  constructor(root: string, timeoutMs = 30_000) {
    super({ timeoutMs });
    this.root = path.resolve(root);
  }

  resolveInsideRoot(inputPath: string): string {
    const candidate = path.isAbsolute(inputPath) ? inputPath : path.resolve(this.root, inputPath);
    let resolved: string;
    try {
      resolved = fs.existsSync(candidate) ? fs.realpathSync(candidate) : path.resolve(candidate);
    } catch {
      resolved = path.resolve(candidate);
    }
    const rootReal = fs.existsSync(this.root) ? fs.realpathSync(this.root) : this.root;
    const rel = path.relative(rootReal, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new ApplicationError('PATH_ESCAPE');
    }
    return resolved;
  }

  relativePath(absolutePath: string): string {
    const direct = path.relative(this.root, absolutePath);
    if (!direct.startsWith('..') && !path.isAbsolute(direct)) {
      return normalizeRelative(direct);
    }
    return normalizeRelative(path.relative(existingRealpath(this.root), existingRealpath(absolutePath)));
  }

  readText(relativePath: string): string {
    const abs = this.resolveInsideRoot(relativePath);
    return fs.readFileSync(abs, 'utf8');
  }

  writeText(relativePath: string, contents: string): void {
    const abs = this.resolveInsideRoot(relativePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents, 'utf8');
  }

  exists(relativePath: string): boolean {
    try {
      const abs = this.resolveInsideRoot(relativePath);
      return fs.existsSync(abs);
    } catch {
      return false;
    }
  }

  fileSize(relativePath: string): number {
    try {
      const abs = this.resolveInsideRoot(relativePath);
      return fs.statSync(abs).size;
    } catch {
      return 0;
    }
  }

  listSourceFiles(): string[] {
    const results: string[] = [];
    this.walk(this.root, results);
    return results;
  }

  watch(onChange: (relativePaths: string[]) => void): () => void {
    if (this.watcher) this.watcher.close();
    this.flushCancel?.();
    const flush = createDebouncedPathFlush(WATCH_DEBOUNCE_MS, onChange);
    this.flushCancel = flush.cancel;
    this.watcher = fs.watch(this.root, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const relativePath = normalizeRelative(filename.toString());
      if (isIgnored(relativePath)) return;
      flush.push(relativePath);
    });
    return () => {
      flush.cancel();
      this.flushCancel = null;
      this.watcher?.close();
      this.watcher = null;
    };
  }

  private walk(dir: string, out: string[]): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = this.relativePath(abs);
      if ((IGNORE_DIR_NAMES as readonly string[]).includes(entry.name)) continue;
      if (isIgnored(rel)) continue;
      if (entry.isDirectory()) {
        this.walk(abs, out);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!SOURCE_EXT.has(path.extname(entry.name).toLowerCase())) continue;
      try {
        if (fs.statSync(abs).size > MAX_FILE_BYTES) continue;
      } catch {
        continue;
      }
      out.push(rel);
    }
  }
}

function existingRealpath(target: string): string {
  try {
    return fs.existsSync(target) ? fs.realpathSync(target) : path.resolve(target);
  } catch {
    return path.resolve(target);
  }
}

function normalizeRelative(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
}
