import type { GitPort } from '../ports/outbound/GitPort.js';

export async function resolveTargetBranch(git: GitPort, targetBranch: string | undefined): Promise<string> {
  const trimmed = targetBranch?.trim() ?? '';
  if (trimmed.length > 0) return trimmed;
  return git.defaultBranch();
}
