export type EnvReachSite = {
  file: string;
  line: number;
  snippet: string;
};

export type TraceEnvInput = {
  env_var_name: string;
};

export type EnvReachOutput = {
  env_var_name: string;
  sites: EnvReachSite[];
};

export interface TraceEnvVariableReach {
  execute(input: TraceEnvInput): Promise<EnvReachOutput>;
}
