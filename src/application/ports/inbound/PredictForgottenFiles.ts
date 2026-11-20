export type ForgottenFile = {
  file: string;
  co_change_frequency: number;
  support: number;
  reason: string;
};

export type PredictForgottenFilesInput = {
  min_confidence: number;
  modified_files?: string[];
};

export type ForgottenFilesOutput = {
  unmodified_co_changes: ForgottenFile[];
};

export interface PredictForgottenFiles {
  execute(input: PredictForgottenFilesInput): Promise<ForgottenFilesOutput>;
}
