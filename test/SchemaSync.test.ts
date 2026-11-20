import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { inputSchema as analyzeSchema, analyzeBlastRadiusTool } from '../src/tools/analyze-blast-radius.js';
import { inputSchema as riskSchema, calculateChangeRiskScoreTool } from '../src/tools/calculate-change-risk-score.js';
import { inputSchema as contractSchema, diffContractAgainstSpecTool } from '../src/tools/diff-contract-against-spec.js';
import { inputSchema as suiteSchema, getTargetedTestSuiteTool } from '../src/tools/get-targeted-test-suite.js';
import { inputSchema as forgottenSchema, predictForgottenFilesTool } from '../src/tools/predict-forgotten-files.js';
import { inputSchema as migrationSchema, simulateMigrationLockImpactTool } from '../src/tools/simulate-migration-lock-impact.js';
import { inputSchema as envSchema, traceEnvVariableReachTool } from '../src/tools/trace-env-variable-reach.js';
import { inputSchema as traceSchema, traceSymbolConsumersTool } from '../src/tools/trace-symbol-consumers.js';

type JsonSchema = {
  properties?: Record<string, { type?: string; enum?: string[] }>;
  required?: string[];
};

type ToolSchema = {
  name: string;
  inputSchema: JsonSchema;
};

const PAIRS: Array<{ zodSchema: z.ZodObject; tool: ToolSchema }> = [
  { zodSchema: analyzeSchema, tool: analyzeBlastRadiusTool },
  { zodSchema: riskSchema, tool: calculateChangeRiskScoreTool },
  { zodSchema: contractSchema, tool: diffContractAgainstSpecTool },
  { zodSchema: suiteSchema, tool: getTargetedTestSuiteTool },
  { zodSchema: forgottenSchema, tool: predictForgottenFilesTool },
  { zodSchema: migrationSchema, tool: simulateMigrationLockImpactTool },
  { zodSchema: envSchema, tool: traceEnvVariableReachTool },
  { zodSchema: traceSchema, tool: traceSymbolConsumersTool },
];

describe('Schema sync', () => {
  describe('when each tool publishes Zod and inputSchema', () => {
    it('should keep names, required flags, enums, and types aligned', () => {
      for (const { zodSchema, tool } of PAIRS) {
        const shape = zodSchema.shape as Record<string, z.ZodType>;
        const properties = tool.inputSchema.properties ?? {};
        expect(Object.keys(properties).sort(), tool.name).toEqual(Object.keys(shape).sort());
        const required = new Set(tool.inputSchema.required ?? []);
        for (const [key, field] of Object.entries(shape)) {
          expect(required.has(key), `${tool.name}.${key}`).toBe(!field.safeParse(undefined).success);
          const property = properties[key];
          const inner = unwrap(field);
          if (property?.enum) expect(enumValues(inner), `${tool.name}.${key}`).toEqual(property.enum);
          expect(jsonType(inner), `${tool.name}.${key}`).toBe(property?.type === 'integer' ? 'integer' : property?.type);
        }
      }
    });
  });
});

function unwrap(field: z.ZodType): z.ZodType {
  let current = field;
  while (current.def.type === 'default' || current.def.type === 'optional') {
    current = current.def.innerType as z.ZodType;
  }
  return current;
}

function enumValues(field: z.ZodType): string[] | null {
  if (field.def.type !== 'enum') return null;
  const entries = field.def.entries as Record<string, string> | undefined;
  return entries ? Object.values(entries) : null;
}

function jsonType(field: z.ZodType): string | undefined {
  if (field.def.type === 'string' || field.def.type === 'enum') return 'string';
  if (field.def.type === 'boolean') return 'boolean';
  if (field.def.type === 'array') return 'array';
  if (field.def.type === 'number') {
    const serialized = JSON.stringify(field.def);
    return serialized.includes('"isInt":true') ? 'integer' : 'number';
  }
  return field.def.type;
}
