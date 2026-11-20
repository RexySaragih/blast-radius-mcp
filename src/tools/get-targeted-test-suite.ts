import { z } from 'zod';
import { ApplicationError } from '../application/errors.js';
import type { GetTargetedTestSuite } from '../application/ports/inbound/GetTargetedTestSuite.js';
import { TOOL_ANNOTATIONS, type ToolResponse } from '../types/index.js';
import { formatTargetedTests, formatToolError } from './format.js';

export const inputSchema = z.object({
  target_branch: z.string().min(1).optional(),
  runner: z.enum(['jest', 'vitest', 'pytest', 'go_test', 'node_test']).default('vitest'),
});

export const getTargetedTestSuiteTool = {
  name: 'get_targeted_test_suite',
  description: 'Build the smallest test command for changed symbols without running it. Uses the workspace root fixed at startup by BLAST_RADIUS_ROOT.',
  inputSchema: {
    type: 'object',
    properties: {
      target_branch: { type: 'string' },
      runner: { type: 'string', enum: ['jest', 'vitest', 'pytest', 'go_test', 'node_test'], default: 'vitest' },
    },
  },
  annotations: TOOL_ANNOTATIONS,
};

export async function handleGetTargetedTestSuite(
  port: GetTargetedTestSuite,
  args: unknown,
): Promise<ToolResponse> {
  try {
    const input = inputSchema.parse(args ?? {});
    const output = await port.execute(input);
    return {
      content: [
        {
          type: 'text',
          text: formatTargetedTests({
            totalProjectTests: output.total_project_tests,
            targetedTestCount: output.targeted_test_count,
            executionCommand: output.execution_command,
            coverageConfidence: output.coverage_confidence,
          }),
        },
      ],
    };
  } catch (error: unknown) {
    return toErrorResponse(error);
  }
}

function toErrorResponse(error: unknown): ToolResponse {
  if (error instanceof ApplicationError) {
    return { content: [{ type: 'text', text: formatToolError(error.code, error.message, error) }], isError: true };
  }
  if (error instanceof z.ZodError) {
    return { content: [{ type: 'text', text: formatToolError('INVALID', error.message) }], isError: true };
  }
  const err = error instanceof Error ? error : new Error('Unknown error');
  return { content: [{ type: 'text', text: formatToolError('INVALID', err.message, err) }], isError: true };
}
