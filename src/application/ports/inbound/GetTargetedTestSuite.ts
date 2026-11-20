export type TestRunner = 'jest' | 'vitest' | 'pytest' | 'go_test' | 'node_test';

export type GetTargetedTestSuiteInput = {
  target_branch?: string;
  runner: TestRunner;
};

export type TargetedTestsOutput = {
  total_project_tests: number;
  targeted_test_count: number;
  execution_command: string;
  coverage_confidence: number;
};

export interface GetTargetedTestSuite {
  execute(input: GetTargetedTestSuiteInput): Promise<TargetedTestsOutput>;
}
