import { z } from 'zod';
import { ApplicationError } from '../application/errors.js';
import type { SimulateMigrationLockImpact } from '../application/ports/inbound/SimulateMigrationLockImpact.js';
import { TOOL_ANNOTATIONS, type ToolResponse } from '../types/index.js';
import { formatMigrationLock, formatToolError } from './format.js';

export const inputSchema = z.object({
  migration_file_path: z.string().min(1),
});

export const simulateMigrationLockImpactTool = {
  name: 'simulate_migration_lock_impact',
  description: 'Static DDL lock-risk notes for one migration file (no DB connection). migration_file_path is relative to the workspace root fixed at startup by BLAST_RADIUS_ROOT.',
  inputSchema: {
    type: 'object',
    properties: {
      migration_file_path: { type: 'string' },
    },
    required: ['migration_file_path'],
  },
  annotations: TOOL_ANNOTATIONS,
};

export async function handleSimulateMigrationLockImpact(
  port: SimulateMigrationLockImpact,
  args: unknown,
): Promise<ToolResponse> {
  try {
    const input = inputSchema.parse(args ?? {});
    const output = await port.execute(input);
    return {
      content: [
        {
          type: 'text',
          text: formatMigrationLock({
            lockRisk: output.lock_risk,
            findings: output.findings.map((code) => ({ code, detail: code })),
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
