import { z } from 'zod';
import { ApplicationError } from '../application/errors.js';
import type { CalculateChangeRiskScore } from '../application/ports/inbound/CalculateChangeRiskScore.js';
import { TOOL_ANNOTATIONS, type ToolResponse } from '../types/index.js';
import { formatRiskScore, formatToolError } from './format.js';

export const inputSchema = z.object({
  target_branch: z.string().min(1).optional(),
});

export const calculateChangeRiskScoreTool = {
  name: 'calculate_change_risk_score',
  description: 'Compute a clamped 0..100 change risk score against a branch. Uses the workspace root fixed at startup by BLAST_RADIUS_ROOT.',
  inputSchema: {
    type: 'object',
    properties: {
      target_branch: { type: 'string' },
    },
  },
  annotations: TOOL_ANNOTATIONS,
};

export async function handleCalculateChangeRiskScore(
  port: CalculateChangeRiskScore,
  args: unknown,
): Promise<ToolResponse> {
  try {
    const input = inputSchema.parse(args ?? {});
    const output = await port.execute(input);
    return {
      content: [
        {
          type: 'text',
          text: formatRiskScore({
            riskScore: output.risk_score,
            riskLevel: output.risk_level,
            depthPoints: output.depth_points,
            apiPoints: output.api_points,
            testGapPoints: output.test_gap_points,
            forgottenPoints: output.forgotten_points,
          }),
        },
      ],
    };
  } catch (error: unknown) {
    if (error instanceof ApplicationError) {
      return { content: [{ type: 'text', text: formatToolError(error.code, error.message, error) }], isError: true };
    }
    if (error instanceof z.ZodError) {
      return { content: [{ type: 'text', text: formatToolError('INVALID', error.message) }], isError: true };
    }
    const err = error instanceof Error ? error : new Error('Unknown error');
    return { content: [{ type: 'text', text: formatToolError('INVALID', err.message, err) }], isError: true };
  }
}
