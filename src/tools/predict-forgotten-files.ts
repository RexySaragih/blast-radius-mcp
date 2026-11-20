import { z } from 'zod';
import { ApplicationError } from '../application/errors.js';
import type { PredictForgottenFiles } from '../application/ports/inbound/PredictForgottenFiles.js';
import { COCHANGE_DEFAULT_CONFIDENCE } from '../domain/Limits.js';
import { TOOL_ANNOTATIONS, type ToolResponse } from '../types/index.js';
import { formatForgottenFiles, formatToolError } from './format.js';

export const inputSchema = z.object({
  min_confidence: z.number().min(0.1).max(1).default(COCHANGE_DEFAULT_CONFIDENCE),
  modified_files: z.array(z.string()).optional(),
});

export const predictForgottenFilesTool = {
  name: 'predict_forgotten_files',
  description: 'Flag co-changed files missing from the current modified set. Uses the workspace root fixed at startup by BLAST_RADIUS_ROOT.',
  inputSchema: {
    type: 'object',
    properties: {
      min_confidence: { type: 'number', minimum: 0.1, maximum: 1, default: COCHANGE_DEFAULT_CONFIDENCE },
      modified_files: { type: 'array', items: { type: 'string' } },
    },
  },
  annotations: TOOL_ANNOTATIONS,
};

export async function handlePredictForgottenFiles(
  port: PredictForgottenFiles,
  args: unknown,
): Promise<ToolResponse> {
  try {
    const input = inputSchema.parse(args ?? {});
    const output = await port.execute(input);
    return {
      content: [
        {
          type: 'text',
          text: formatForgottenFiles(
            output.unmodified_co_changes.map((row) => ({
              file: row.file,
              coChangeFrequency: row.co_change_frequency,
              reason: row.reason,
            })),
          ),
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
