import { z } from 'zod';
import { ApplicationError } from '../application/errors.js';
import type { DiffContractAgainstSpec } from '../application/ports/inbound/DiffContractAgainstSpec.js';
import { TOOL_ANNOTATIONS, type ToolResponse } from '../types/index.js';
import { formatContractDiff, formatToolError } from './format.js';

export const inputSchema = z.object({
  spec_path: z.string().min(1),
  modified_controller: z.string().optional(),
});

export const diffContractAgainstSpecTool = {
  name: 'diff_contract_against_spec',
  description: 'Diff OpenAPI/GraphQL/Protobuf specs against indexed implementation. spec_path is relative to the workspace root fixed at startup by BLAST_RADIUS_ROOT.',
  inputSchema: {
    type: 'object',
    properties: {
      spec_path: { type: 'string' },
      modified_controller: { type: 'string' },
    },
    required: ['spec_path'],
  },
  annotations: TOOL_ANNOTATIONS,
};

export async function handleDiffContractAgainstSpec(
  port: DiffContractAgainstSpec,
  args: unknown,
): Promise<ToolResponse> {
  try {
    const input = inputSchema.parse(args ?? {});
    const output = await port.execute(input);
    return {
      content: [
        {
          type: 'text',
          text: formatContractDiff(
            output.drifts.map((drift) => ({
              code: drift.code,
              path: drift.detail || drift.name,
              detail: drift.name,
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
