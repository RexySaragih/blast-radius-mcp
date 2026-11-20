export type CommitTouch = {
  commit: string;
  files: string[];
};

export interface GitPort {
  ensureRepo(): Promise<void>;
  defaultBranch(): Promise<string>;
  changedFiles(targetBranch: string): Promise<string[]>;
  showFile(revision: string, filePath: string): Promise<string | null>;
  diffAgainst(targetBranch: string): Promise<string>;
  logTouches(paths: string[], maxCommits: number): Promise<CommitTouch[]>;
  workingTreeFiles(): Promise<string[]>;
}
