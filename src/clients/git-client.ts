import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { ApplicationError } from '../application/errors.js';
import type { CommitTouch, GitPort } from '../application/ports/outbound/GitPort.js';
import { GIT_TIMEOUT_MS } from '../domain/Limits.js';
import { BaseClient } from './base-client.js';

const execFileAsync = promisify(execFile);

export class GitCli extends BaseClient implements GitPort {
  constructor(
    private readonly root: string,
    timeoutMs = GIT_TIMEOUT_MS,
  ) {
    super({ timeoutMs });
  }

  static detectToplevel(cwd: string): string | null {
    try {
      const out = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd,
        encoding: 'utf8',
        timeout: GIT_TIMEOUT_MS,
      });
      return out.trim();
    } catch {
      return null;
    }
  }

  async ensureRepo(): Promise<void> {
    try {
      await this.git(['rev-parse', '--is-inside-work-tree']);
    } catch {
      throw new ApplicationError('NOT_A_REPOSITORY');
    }
  }

  async defaultBranch(): Promise<string> {
    await this.ensureRepo();
    const originHead = await this.gitText(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
    const fromOrigin = shortBranch(originHead);
    if (fromOrigin) return fromOrigin;
    for (const name of ['main', 'master']) {
      if (await this.refExists(name)) return name;
    }
    return 'HEAD';
  }

  async changedFiles(targetBranch: string): Promise<string[]> {
    await this.ensureRepo();
    const tracked = await this.git(['diff', '--name-only', targetBranch]);
    const untracked = await this.git(['ls-files', '--others', '--exclude-standard']);
    return uniqueLines(tracked, untracked);
  }

  async showFile(revision: string, filePath: string): Promise<string | null> {
    await this.ensureRepo();
    try {
      return await this.git(['show', `${revision}:${filePath}`]);
    } catch {
      return null;
    }
  }

  async diffAgainst(targetBranch: string): Promise<string> {
    await this.ensureRepo();
    return this.git(['diff', targetBranch]);
  }

  async logTouches(paths: string[], maxCommits: number): Promise<CommitTouch[]> {
    await this.ensureRepo();
    const out = await this.git([
      'log',
      `--max-count=${maxCommits}`,
      '--full-diff',
      '--name-only',
      '--pretty=format:%H',
      '--',
      ...paths,
    ]);
    return parseLogTouches(out);
  }

  async workingTreeFiles(): Promise<string[]> {
    await this.ensureRepo();
    const out = await this.git(['ls-files']);
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  private async refExists(name: string): Promise<boolean> {
    const verified = await this.gitText(['rev-parse', '--verify', '--quiet', name]);
    return verified.trim().length > 0;
  }

  private async gitText(args: string[]): Promise<string> {
    try {
      return await this.git(args);
    } catch (error: unknown) {
      if (error instanceof ApplicationError && error.code === 'NOT_A_REPOSITORY') throw error;
      return '';
    }
  }

  private async git(args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', args, {
        cwd: this.root,
        timeout: this.timeoutMs,
        encoding: 'utf8',
      });
      return stdout;
    } catch (error: unknown) {
      const detail = gitFailureText(error);
      if (/unknown revision|bad revision|ambiguous argument/i.test(detail)) {
        throw new ApplicationError('INVALID', 'unknown target_branch');
      }
      throw new ApplicationError('INVALID', 'git failed');
    }
  }
}

function shortBranch(ref: string): string {
  const trimmed = ref.trim();
  if (!trimmed) return '';
  const slash = trimmed.lastIndexOf('/');
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

function gitFailureText(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const stderr = 'stderr' in error && typeof error.stderr === 'string' ? error.stderr : '';
  const message = error instanceof Error ? error.message : '';
  return `${stderr}\n${message}`;
}

function uniqueLines(...chunks: string[]): string[] {
  const files = new Set<string>();
  for (const chunk of chunks) {
    for (const line of chunk.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) files.add(trimmed);
    }
  }
  return [...files];
}

function parseLogTouches(out: string): CommitTouch[] {
  const touches: CommitTouch[] = [];
  let current: CommitTouch | null = null;
  for (const raw of out.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^[0-9a-f]{7,40}$/i.test(line)) {
      current = { commit: line, files: [] };
      touches.push(current);
      continue;
    }
    if (current) current.files.push(line);
  }
  return touches;
}
