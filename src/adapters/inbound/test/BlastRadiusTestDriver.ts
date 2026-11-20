import type {
  AnalyzeBlastRadius,
  AnalyzeBlastRadiusInput,
  BlastRadiusOutput,
} from '../../../application/ports/inbound/AnalyzeBlastRadius.js';
import type { TraceConsumersInput, TraceConsumersOutput, TraceSymbolConsumers } from '../../../application/ports/inbound/TraceSymbolConsumers.js';
import type {
  TraverseCallers,
  TraverseCallersInput,
  TraverseCallersOutput,
} from '../../../application/use-cases/TraverseCallers.js';

export class BlastRadiusTestDriver {
  constructor(
    private readonly ports: {
      traverseCallers: TraverseCallers;
      traceSymbolConsumers?: TraceSymbolConsumers;
      analyzeBlastRadius?: AnalyzeBlastRadius;
    },
  ) {}

  traverseCallers(input: TraverseCallersInput): TraverseCallersOutput {
    return this.ports.traverseCallers.execute(input);
  }

  async traceSymbolConsumers(input: TraceConsumersInput): Promise<TraceConsumersOutput> {
    if (!this.ports.traceSymbolConsumers) {
      throw new Error('traceSymbolConsumers port not configured');
    }
    return this.ports.traceSymbolConsumers.execute(input);
  }

  async analyzeBlastRadius(input: AnalyzeBlastRadiusInput): Promise<BlastRadiusOutput> {
    if (!this.ports.analyzeBlastRadius) {
      throw new Error('analyzeBlastRadius port not configured');
    }
    return this.ports.analyzeBlastRadius.execute(input);
  }
}
