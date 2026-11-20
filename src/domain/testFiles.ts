export function matchesRunner(filePath: string, runner: string): boolean {
  if (runner === 'pytest') {
    return filePath.endsWith('.py') && (/(^|\/)test_[^/]+\.py$/.test(filePath) || filePath.endsWith('_test.py'));
  }
  if (runner === 'go_test') {
    return filePath.endsWith('_test.go');
  }
  if (runner === 'node_test' || runner === 'jest' || runner === 'vitest') {
    return /\.(test|spec)\.[cm]?[jt]sx?$/.test(filePath);
  }
  return false;
}

export function isTestFile(filePath: string): boolean {
  return (
    matchesRunner(filePath, 'vitest') ||
    matchesRunner(filePath, 'pytest') ||
    matchesRunner(filePath, 'go_test') ||
    /(?:^|\/)tests?\//.test(filePath)
  );
}
