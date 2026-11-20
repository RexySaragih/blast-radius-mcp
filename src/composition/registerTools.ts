import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { analyzeBlastRadiusTool, handleAnalyzeBlastRadius } from '../tools/analyze-blast-radius.js';
import {
  calculateChangeRiskScoreTool,
  handleCalculateChangeRiskScore,
} from '../tools/calculate-change-risk-score.js';
import {
  diffContractAgainstSpecTool,
  handleDiffContractAgainstSpec,
} from '../tools/diff-contract-against-spec.js';
import { getTargetedTestSuiteTool, handleGetTargetedTestSuite } from '../tools/get-targeted-test-suite.js';
import { handlePredictForgottenFiles, predictForgottenFilesTool } from '../tools/predict-forgotten-files.js';
import {
  handleSimulateMigrationLockImpact,
  simulateMigrationLockImpactTool,
} from '../tools/simulate-migration-lock-impact.js';
import { handleTraceEnvVariableReach, traceEnvVariableReachTool } from '../tools/trace-env-variable-reach.js';
import { handleTraceSymbolConsumers, traceSymbolConsumersTool } from '../tools/trace-symbol-consumers.js';
import type { BlastRadiusRuntime } from './createRuntime.js';
import type { ToolResponse } from '../types/index.js';

export type ToolHandler = (args: unknown) => Promise<ToolResponse>;

export function registerTools(runtime: BlastRadiusRuntime): {
  tools: Tool[];
  handlers: Record<string, ToolHandler>;
} {
  const tools: Tool[] = [
    analyzeBlastRadiusTool as Tool,
    traceSymbolConsumersTool as Tool,
    getTargetedTestSuiteTool as Tool,
    diffContractAgainstSpecTool as Tool,
    traceEnvVariableReachTool as Tool,
    predictForgottenFilesTool as Tool,
    calculateChangeRiskScoreTool as Tool,
    simulateMigrationLockImpactTool as Tool,
  ];

  const handlers: Record<string, ToolHandler> = {
    analyze_blast_radius: (args) => handleAnalyzeBlastRadius(runtime.analyzeBlastRadius, args),
    trace_symbol_consumers: (args) => handleTraceSymbolConsumers(runtime.traceSymbolConsumers, args),
    get_targeted_test_suite: (args) => handleGetTargetedTestSuite(runtime.getTargetedTestSuite, args),
    diff_contract_against_spec: (args) => handleDiffContractAgainstSpec(runtime.diffContract, args),
    trace_env_variable_reach: (args) => handleTraceEnvVariableReach(runtime.traceEnv, args),
    predict_forgotten_files: (args) => handlePredictForgottenFiles(runtime.predictForgotten, args),
    calculate_change_risk_score: (args) => handleCalculateChangeRiskScore(runtime.calculateRisk, args),
    simulate_migration_lock_impact: (args) => handleSimulateMigrationLockImpact(runtime.simulateMigration, args),
  };

  return { tools, handlers };
}
