import { z } from 'zod';
import type { TraceSymbolConsumers } from '../application/ports/inbound/TraceSymbolConsumers.js';
import { ApplicationError } from '../application/errors.js';
import { DEFAULT_MAX_DEPTH, HARD_MAX_DEPTH, MIN_MAX_DEPTH } from '../domain/Limits.js';
import { TOOL_ANNOTATIONS, type ToolResponse } from '../types/index.js';
import { formatToolError, formatTraceConsumers } from './format.js';

export const inputSchema = z.object({
  symbol_name: z.string().min(1),
  source_file: z.string().min(1),
  max_depth: z.number().int().min(MIN_MAX_DEPTH).max(HARD_MAX_DEPTH).default(DEFAULT_MAX_DEPTH),
});

export const traceSymbolConsumersTool = {
  name: 'trace_symbol_consumers',
  description: 'List callers, routes, and event handlers for one symbol definition. source_file is relative to the workspace root fixed at startup by BLAST_RADIUS_ROOT.',
  inputSchema: {
    type: 'object',
    properties: {
      symbol_name: { type: 'string' },
      source_file: { type: 'string' },
      max_depth: { type: 'integer', minimum: MIN_MAX_DEPTH, maximum: HARD_MAX_DEPTH, default: DEFAULT_MAX_DEPTH },
    },
    required: ['symbol_name', 'source_file'],
  },
  annotations: TOOL_ANNOTATIONS,
};

export async function handleTraceSymbolConsumers(
  port: TraceSymbolConsumers,
  args: unknown,
): Promise<ToolResponse> {
  try {
    const input = inputSchema.parse(args);
    const output = await port.execute(input);
    const formatted = formatTraceConsumers({
      symbol: output.symbol,
      callers: output.callers.map((caller) => ({
        name: caller.name,
        file: caller.file,
        line: caller.line,
        depth: caller.depth,
        route: caller.route || undefined,
      })),
      routes: output.routes,
      eventHandlers: output.event_handlers,
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
