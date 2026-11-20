import {
  COCHANGE_DEFAULT_CONFIDENCE,
  COCHANGE_HISTORY_COMMITS,
  COCHANGE_MIN_SUPPORT,
  MAX_COCHANGE_RESULTS,
} from '../../domain/Limits.js';
import type {
  ForgottenFile,
  ForgottenFilesOutput,
  PredictForgottenFiles,
  PredictForgottenFilesInput,
} from '../ports/inbound/PredictForgottenFiles.js';
import type { GitPort } from '../ports/outbound/GitPort.js';

type ForgottenPair = {
  frequency: number;
  withA: number;
  aCommits: number;
  anchor: string;
};

export class PredictForgottenFilesUseCase implements PredictForgottenFiles {
  constructor(private readonly git: GitPort) {}

  async execute(input: PredictForgottenFilesInput): Promise<ForgottenFilesOutput> {
    await this.git.ensureRepo();
    const minConfidence = input.min_confidence ?? COCHANGE_DEFAULT_CONFIDENCE;
    const modified = (input.modified_files ?? (await this.git.workingTreeFiles())).map(normalize);
    if (modified.length === 0) {
      return { unmodified_co_changes: [] };
    }

    const history = await this.git.logTouches(modified, COCHANGE_HISTORY_COMMITS);
    const bestByPartner = new Map<string, ForgottenPair>();

    for (const a of modified) {
      const commitsTouchingA = history.filter((touch) => touch.files.map(normalize).includes(a));
      const aCount = commitsTouchingA.length;
      if (aCount < COCHANGE_MIN_SUPPORT) continue;
      const withA = new Map<string, number>();
      for (const touch of commitsTouchingA) {
        const seen = new Set<string>();
        for (const raw of touch.files) {
          const partner = normalize(raw);
          if (partner === a || modified.includes(partner) || seen.has(partner)) continue;
          seen.add(partner);
          withA.set(partner, (withA.get(partner) ?? 0) + 1);
        }
      }
      for (const [file, count] of withA) {
        const frequency = Math.min(1, count / aCount);
        const existing = bestByPartner.get(file);
        if (existing && existing.frequency >= frequency) continue;
        bestByPartner.set(file, { frequency, withA: count, aCommits: aCount, anchor: a });
      }
    }

    const results: ForgottenFile[] = [];
    for (const [file, stats] of bestByPartner) {
      if (stats.frequency < minConfidence) continue;
      const rounded = Math.round(stats.frequency * 100) / 100;
      results.push({
        file,
        co_change_frequency: rounded,
        support: stats.withA,
        reason: `Modified in ${stats.withA} out of last ${stats.aCommits} commits affecting ${stats.anchor}`,
      });
    }

    results.sort((left, right) => right.co_change_frequency - left.co_change_frequency);
    return { unmodified_co_changes: results.slice(0, MAX_COCHANGE_RESULTS) };
  }
}

function normalize(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}
