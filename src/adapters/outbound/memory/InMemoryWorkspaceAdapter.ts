import path from 'node:path';
import { ApplicationError } from '../../../application/errors.js';
import type { WorkspacePort } from '../../../application/ports/outbound/WorkspacePort.js';
import { MAX_FILE_BYTES } from '../../../domain/Limits.js';
import { SOURCE_EXT, exceedsMaxFileBytes, isIgnored } from '../../../domain/sourceFiles.js';

export class InMemoryWorkspaceAdapter implements WorkspacePort {
  readonly root: string;
  private readonly files = new Map<string, string>();

  constructor(root = '/repo') {
    this.root = path.resolve(root);
  }

  seed(files: Record<string, string>): void {
    for (const [relativePath, contents] of Object.entries(files)) {
      this.files.set(normalizeRelative(relativePath), contents);
    }
  }

  resolveInsideRoot(inputPath: string): string {
    const abs = path.resolve(this.root, inputPath);
    const rel = path.relative(this.root, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new ApplicationError('PATH_ESCAPE');
    }
    return abs;
  }

  readText(relativePath: string): string {
    const rel = this.relativePath(this.resolveInsideRoot(relativePath));
    const contents = this.files.get(rel);
    if (contents === undefined) {
      throw new ApplicationError('INVALID', `Missing file ${rel}`);
    }
    return contents;
  }

  writeText(relativePath: string, contents: string): void {
    const rel = this.relativePath(this.resolveInsideRoot(relativePath));
    this.files.set(rel, contents);
  }

  listSourceFiles(): string[] {
    return [...this.files.keys()].filter((filePath) => {
      if (isIgnored(filePath)) return false;
      if (exceedsMaxFileBytes(Buffer.byteLength(this.files.get(filePath) ?? ''))) return false;
      return SOURCE_EXT.has(path.extname(filePath).toLowerCase());
    });
  }

  fileSize(relativePath: string): number {
    return Buffer.byteLength(this.files.get(normalizeRelative(relativePath)) ?? '');
  }

  exists(relativePath: string): boolean {
    return this.files.has(normalizeRelative(relativePath));
  }

  relativePath(absolutePath: string): string {
    return normalizeRelative(path.relative(this.root, absolutePath));
  }
}

function normalizeRelative(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

export { SOURCE_EXT, isIgnored, MAX_FILE_BYTES };
