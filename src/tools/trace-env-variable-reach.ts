import { z } from 'zod';
import { ApplicationError } from '../application/errors.js';
import type { TraceEnvVariableReach } from '../application/ports/inbound/TraceEnvVariableReach.js';
import { TOOL_ANNOTATIONS, type ToolResponse } from '../types/index.js';
import { formatEnvReach, formatToolError } from './format.js';

export const inputSchema = z.object({
  env_var_name: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
});

export const traceEnvVariableReachTool = {
  name: 'trace_env_variable_reach',
  description: 'Find where an environment variable name is read (never the value). Scans the workspace root fixed at startup by BLAST_RADIUS_ROOT.',
  inputSchema: {
    type: 'object',
    properties: {
      env_var_name: { type: 'string', pattern: '^[A-Z][A-Z0-9_]*$' },
    },
    required: ['env_var_name'],
  },
  annotations: TOOL_ANNOTATIONS,
};

export async function handleTraceEnvVariableReach(
  port: TraceEnvVariableReach,
  args: unknown,
): Promise<ToolResponse> {
  try {
    const input = inputSchema.parse(args ?? {});
    const output = await port.execute(input);
    return {
      content: [
        {
          type: 'text',
          text: formatEnvReach(
            output.sites.map((site) => ({
              file: site.file,
              line: site.line,
              snippet: site.snippet,
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
