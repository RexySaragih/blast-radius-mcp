export type TraceConsumersInput = {
  symbol_name: string;
  source_file: string;
  max_depth: number;
};

export type CallerHit = {
  name: string;
  file: string;
  line: number;
  depth: number;
  route: string;
};

export type TraceConsumersOutput = {
  symbol: string;
  callers: CallerHit[];
  routes: string[];
  event_handlers: string[];
  truncated: boolean;
  omitted_count: number;
};

export interface TraceSymbolConsumers {
  execute(input: TraceConsumersInput): Promise<TraceConsumersOutput>;
}
