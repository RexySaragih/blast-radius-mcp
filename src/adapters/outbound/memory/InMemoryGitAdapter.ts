import { ApplicationError } from '../../../application/errors.js';
import type { CommitTouch, GitPort } from '../../../application/ports/outbound/GitPort.js';

export class InMemoryGitAdapter implements GitPort {
  private isRepo = true;
  private working: string[] = [];
  private diffs = new Map<string, string>();
  private history: CommitTouch[] = [];
  private revisions = new Map<string, string>();

  setRepo(isRepo: boolean): void {
    this.isRepo = isRepo;
  }

  setWorkingTree(files: string[]): void {
    this.working = files;
  }

  setDiff(targetBranch: string, diff: string): void {
    this.diffs.set(targetBranch, diff);
  }

  setHistory(history: CommitTouch[]): void {
    this.history = history;
  }

  async ensureRepo(): Promise<void> {
    if (!this.isRepo) {
      throw new ApplicationError('NOT_A_REPOSITORY');
    }
  }

  async defaultBranch(): Promise<string> {
    await this.ensureRepo();
    return 'main';
  }

  async changedFiles(_targetBranch: string): Promise<string[]> {
    await this.ensureRepo();
    return [...this.working];
  }

  async showFile(revision: string, filePath: string): Promise<string | null> {
    await this.ensureRepo();
    return this.revisions.get(`${revision}:${normalize(filePath)}`) ?? null;
  }

  setRevisionFile(revision: string, filePath: string, content: string): void {
    this.revisions.set(`${revision}:${normalize(filePath)}`, content);
  }

  async diffAgainst(targetBranch: string): Promise<string> {
    await this.ensureRepo();
    return this.diffs.get(targetBranch) ?? '';
  }

  async logTouches(paths: string[], maxCommits: number): Promise<CommitTouch[]> {
    await this.ensureRepo();
    const wanted = new Set(paths);
    return this.history.filter((touch) => touch.files.some((file) => wanted.has(file))).slice(0, maxCommits);
  }

  async workingTreeFiles(): Promise<string[]> {
    await this.ensureRepo();
    return [...this.working];
  }
}

function normalize(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}
