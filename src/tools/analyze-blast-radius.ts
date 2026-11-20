import { z } from 'zod';
import type { AnalyzeBlastRadius } from '../application/ports/inbound/AnalyzeBlastRadius.js';
import { ApplicationError } from '../application/errors.js';
import { DEFAULT_MAX_DEPTH, HARD_MAX_DEPTH, MIN_MAX_DEPTH } from '../domain/Limits.js';
import { TOOL_ANNOTATIONS, type ToolResponse } from '../types/index.js';
import { formatAnalyzeBlastRadius, formatToolError } from './format.js';

export const inputSchema = z.object({
  diff: z.string().min(1),
  max_depth: z.number().int().min(MIN_MAX_DEPTH).max(HARD_MAX_DEPTH).default(DEFAULT_MAX_DEPTH),
  include_tests: z.boolean().default(true),
});

export const analyzeBlastRadiusTool = {
  name: 'analyze_blast_radius',
  description: 'Classify a pasted diff and list caller impact, routes, and risk band. Paths are inside the workspace root fixed at startup by BLAST_RADIUS_ROOT.',
  inputSchema: {
    type: 'object',
    properties: {
      diff: { type: 'string' },
      max_depth: { type: 'integer', minimum: MIN_MAX_DEPTH, maximum: HARD_MAX_DEPTH, default: DEFAULT_MAX_DEPTH },
      include_tests: { type: 'boolean', default: true },
    },
    required: ['diff'],
  },
  annotations: TOOL_ANNOTATIONS,
};

export async function handleAnalyzeBlastRadius(
  port: AnalyzeBlastRadius,
  args: unknown,
): Promise<ToolResponse> {
  try {
    const input = inputSchema.parse(args);
    const output = await port.execute(input);
    const formatted = formatAnalyzeBlastRadius({
      modifiedSymbols: output.modified_symbols.map(
        (symbol) => `${symbol.name} ${symbol.file} ${symbol.change}`,
      ),
      directCallers: output.impact_summary.direct_callers,
      indirectCallers: output.impact_summary.indirect_callers,
      affectedRoutes: output.impact_summary.affected_routes,
      affectedDbModels: output.impact_summary.affected_db_models,
      riskLevel: output.impact_summary.risk_level,
      riskScore: output.impact_summary.risk_score,
      impactTree: output.impact_tree.map((row) => ({
        name: row.name,
        file: row.file,
        line: row.line,
        depth: row.depth,
        route: row.route_label ?? (row.kind === 'route' ? row.name : undefined),
      })),
      affectedTestFiles: output.affected_test_files,
      unresolvedCalls: output.unresolved_calls,
    });
    return { content: [{ type: 'text', text: formatted.text }] };
  } catch (error: unknown) {
    if (error instanceof ApplicationError) {
      return {
        content: [{ type: 'text', text: formatToolError(error.code, error.message, error) }],
        isError: true,
      };
    }
    if (error instanceof z.ZodError) {
      return {
        content: [{ type: 'text', text: formatToolError('INVALID', error.message) }],
        isError: true,
      };
    }
    const err = error instanceof Error ? error : new Error('Unknown error');
    return {
      content: [{ type: 'text', text: formatToolError('INVALID', err.message, err) }],
      isError: true,
    };
  }
}
