export const DEFAULT_MAX_DEPTH = 3;
export const MIN_MAX_DEPTH = 1;
export const HARD_MAX_DEPTH = 10;
export const MAX_DIFF_CHARS = 200_000;
export const MAX_IMPACT_NODES = 100;
export const MAX_COCHANGE_RESULTS = 20;
export const COCHANGE_MIN_SUPPORT = 5;
export const COCHANGE_HISTORY_COMMITS = 200;
export const COCHANGE_DEFAULT_CONFIDENCE = 0.7;
export const COVERAGE_UNRESOLVED_FACTOR = 0.8;
export const MAX_FILE_BYTES = 1_000_000;
export const WATCH_DEBOUNCE_MS = 200;
export const GIT_TIMEOUT_MS = 30_000;
export const SQLITE_BUSY_TIMEOUT_MS = 30_000;
export const PARSE_TIMEOUT_MS = 2_000;
export const RISK_DEPTH_CAP = 30;
export const RISK_DEPTH_STEP = 10;
export const RISK_DEPTH_FREE_LAYERS = 2;
export const RISK_API_CAP = 25;
export const RISK_API_STEP = 15;
export const RISK_TEST_GAP_POINTS = 25;
export const RISK_FORGOTTEN_POINTS = 20;
export const RISK_MEDIUM_MIN = 25;
export const RISK_HIGH_MIN = 50;
export const RISK_CRITICAL_MIN = 75;
export const MAX_FORMAT_CHARS = 8_000;
export const REINDEX_BUDGET_MS = 5_000;

export const IGNORE_DIR_NAMES = [
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  '.mcp',
  'vendor',
  'target',
  '__pycache__',
  '.next',
  '.turbo',
] as const;

export const Limits = {
  DEFAULT_MAX_DEPTH,
  MIN_MAX_DEPTH,
  HARD_MAX_DEPTH,
  MAX_DIFF_CHARS,
  MAX_IMPACT_NODES,
  MAX_COCHANGE_RESULTS,
  COCHANGE_MIN_SUPPORT,
  COCHANGE_HISTORY_COMMITS,
  COCHANGE_DEFAULT_CONFIDENCE,
  COVERAGE_UNRESOLVED_FACTOR,
  MAX_FILE_BYTES,
  WATCH_DEBOUNCE_MS,
  GIT_TIMEOUT_MS,
  SQLITE_BUSY_TIMEOUT_MS,
  PARSE_TIMEOUT_MS,
  RISK_DEPTH_CAP,
  RISK_DEPTH_STEP,
  RISK_DEPTH_FREE_LAYERS,
  RISK_API_CAP,
  RISK_API_STEP,
  RISK_TEST_GAP_POINTS,
  RISK_FORGOTTEN_POINTS,
  RISK_MEDIUM_MIN,
  RISK_HIGH_MIN,
  RISK_CRITICAL_MIN,
  MAX_FORMAT_CHARS,
  REINDEX_BUDGET_MS,
  IGNORE_DIR_NAMES,
} as const;
