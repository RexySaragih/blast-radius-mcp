# TOOL_SPEC — blast-radius-mcp

## Goal
Give coding agents compact, local call-graph, boundary, test, co-change, and risk impact for a git working tree without running tests or SQL.

## Non-goals
- HTTP or SSE MCP transport
- MCP Resources / Prompts
- Executing tests, spawning pytest/jest/vitest/go test/node --test as a product feature
- Executing SQL or opening a database connection for migration analysis
- Editing source, git objects, or files outside `{root}/.mcp/`
- Fetching spec URLs or any network I/O
- tsserver-level typechecking, JUnit, IDE UI
- Project `.env` / `dotenv` loading

## Research summary
- API docs: local git CLI, Tree-sitter WASM, Node `node:sqlite` (no SaaS)
- API version / base path: n/a (closed local workspace)
- Auth model: none — operator chooses the workspace root at process start via `BLAST_RADIUS_ROOT`, else `git rev-parse --show-toplevel`, else cwd. Tool file arguments are relative to that root.
- SDK choice: `@modelcontextprotocol/sdk` 1.32.2 (v1.x maintenance line with tool annotations) + `zod`; `web-tree-sitter` + `tree-sitter-wasms`
- Existing MCP: build (no reuse of a blast-radius server)
- Language: TypeScript (default)
- Transport: stdio (default)
- Residual risks: prompt injection via untrusted repo text; server reads private source and git history for the local agent; cache write under `{root}/.mcp/blast_radius.db` (not a source edit). No network exfil tool.

## Identity & credentials
| Env var | Required | Purpose |
|---------|----------|---------|
| BLAST_RADIUS_ROOT | no | Workspace root, read once at process start. When unset, git toplevel of the process cwd, else the cwd. Restart the process to change it. |

**Secret location:** user agent mcp.json `env` (not project `.env`). This server has no tokens.

Scopes: none. Local filesystem + git of the chosen root only.
Identity: operator-chosen local root (not a shared SaaS bot).

## v1 posture
- [x] read-only (does not edit source or git; may write an index cache under `{root}/.mcp/`)
- [ ] writes included (user confirmed)
- [ ] destructive included (user confirmed)

Cache note (ADR-011): `readOnlyHint` is true because tools do not mutate source. The SQLite file `{root}/.mcp/blast_radius.db` is a derived cache (WAL). A second process waits up to `SQLITE_BUSY_TIMEOUT_MS` (30000) instead of crashing on `database is locked`. README states this.

## Tools

| Name | Job | Annotations (R/D/I/O) | Output format | Endpoint / SDK |
|------|-----|----------------------|---------------|----------------|
| analyze_blast_radius | Semantic diff + caller impact for a pasted diff | T/F/T/F | compact text | local index + Tree-sitter |
| trace_symbol_consumers | Callers of one definition (workflow A) | T/F/T/F | compact text | local index BFS |
| get_targeted_test_suite | Smallest test command (does not run it) | T/F/T/F | compact text | index + git diff |
| diff_contract_against_spec | Name-level OpenAPI/GraphQL/Protobuf drift | T/F/T/F | compact text | files inside root |
| trace_env_variable_reach | Where an env name is read (never the value) | T/F/T/F | compact text | static scan |
| predict_forgotten_files | Co-changed files missing from the current set | T/F/T/F | compact text | git log, last 200 commits |
| calculate_change_risk_score | Clamped 0..100 score vs a branch | T/F/T/F | compact text | ADR-007 factors |
| simulate_migration_lock_impact | Static DDL lock notes (no DB connect) | T/F/T/F | compact text | file text heuristics |

R=readOnlyHint D=destructiveHint I=idempotentHint O=openWorldHint

All eight tools: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`.

File arguments are paths inside the root fixed at process start (`BLAST_RADIUS_ROOT`, else the git toplevel, else cwd).

Shared error codes in text (no stacks, no source dump): `INVALID`, `PATH_ESCAPE`, `DIFF_TOO_LARGE`, `NOT_A_REPOSITORY`, `UNSUPPORTED_RUNNER`, `UNSUPPORTED_LANGUAGE`, `SYMBOL_NOT_FOUND`, `SPEC_NOT_FOUND`.

Shared Zod bounds: `max_depth` integer default 3, min 1, max 10 (`DEFAULT_MAX_DEPTH` / `MIN_MAX_DEPTH` / `HARD_MAX_DEPTH`). Diffs over `MAX_DIFF_CHARS` (200000) return `DIFF_TOO_LARGE`. Impact lists cap at `MAX_IMPACT_NODES` (100) then `truncated: true` plus `omitted_count`.

### Tool detail — `analyze_blast_radius`
- Required params: `diff` (string)
- Optional params (defaults): `max_depth` (3), `include_tests` (true)
- Caps / truncation: `MAX_DIFF_CHARS`; `MAX_IMPACT_NODES`; formatter budget 8000 chars for 20 rows
- Errors: `INVALID`, `DIFF_TOO_LARGE`, `PATH_ESCAPE`
- Output sections: `modified_symbols`, `impact_summary` (`direct_callers`, `indirect_callers`, `affected_routes`, `affected_db_models`, `risk_level`, `risk_score`), `impact_tree`, `affected_test_files`, `unresolved_calls`, `truncated`
- Behavior: parse changed paths, reindex those inside the root, classify added/removed/signature_modified/body_modified, traverse incoming callers. Depth-0 roots omitted. `include_tests` false omits test paths from `impact_tree` and `affected_test_files`.

### Tool detail — `trace_symbol_consumers`
- Required params: `symbol_name`, `source_file`
- Optional params (defaults): `max_depth` (3)
- Caps / truncation: `MAX_IMPACT_NODES`
- Errors: `INVALID`, `PATH_ESCAPE`, `SYMBOL_NOT_FOUND`
- Output: `symbol`, `callers` (name, file, line, depth, route or empty), `routes`, `event_handlers`, `truncated`
- Behavior: BFS on incoming edges, visited set, halt after recording `is_boundary` nodes.

### Tool detail — `get_targeted_test_suite`
- Required params: none
- Optional params (defaults): `target_branch` omitted detects `origin/HEAD`, else `main`, else `master`, else `HEAD`; `runner` enum `jest` | `vitest` | `pytest` | `go_test` | `node_test` (default `vitest`). When the requested runner is `vitest` or `jest` and the root `package.json` `test` script runs `node --test` (and does not name that runner), the command uses `node_test`.
- Caps / truncation: command lists linked test files only
- Errors: `INVALID`, `NOT_A_REPOSITORY`, `UNSUPPORTED_RUNNER`
- Output: `total_project_tests`, `targeted_test_count`, `execution_command`, `coverage_confidence`
- Commands: `npx vitest run <files>` / `npx jest <files>` / `pytest <files>` / `go test <package dirs>` / `node --test <files>`. Does not spawn the runner.
- An explicit missing `target_branch` is `INVALID` with message `unknown target_branch` and no git stderr.
- `coverage_confidence`: `linkedModifiedSymbols / max(1, modifiedSymbolCount)`, 2 decimals, × `COVERAGE_UNRESOLVED_FACTOR` (0.8) when `unresolved_calls > 0`.

### Tool detail — `diff_contract_against_spec`
- Required params: `spec_path`
- Optional params (defaults): `modified_controller` omitted → compare every indexed file of that spec kind; when set, compare only that file (`INVALID` if the file is missing)
- Caps / truncation: paths jailed to root
- Errors: `INVALID`, `PATH_ESCAPE`, `SPEC_NOT_FOUND`
- Drift codes: `MISSING_IN_SPEC`, `MISSING_IN_CODE`, `TYPE_MISMATCH` (scalars `string`, `number`, `boolean`, `integer` only when both sides state one)
- Kinds by extension: `.yaml`/`.yml`/`.json` OpenAPI; `.graphql`/`.gql` GraphQL; `.proto` Protobuf (line parser)

### Tool detail — `trace_env_variable_reach`
- Required params: `env_var_name` (pattern `^[A-Z][A-Z0-9_]*$`)
- Optional params (defaults): none
- Caps / truncation: snippet values redacted to the identifier
- Errors: `INVALID`
- Matches: `process.env.NAME`, `process.env["NAME"]`, `os.Getenv("NAME")`, `os.getenv("NAME")`, `System.getenv("NAME")`, `env.NAME`, `env["NAME"]`
- Must never interpolate `process.env[name]` into the result.

### Tool detail — `predict_forgotten_files`
- Required params: none
- Optional params (defaults): `min_confidence` (0.70, min 0.1, max 1), `modified_files` (omitted → git working tree files)
- Caps / truncation: `MAX_COCHANGE_RESULTS` (20); support `COCHANGE_MIN_SUPPORT` (5) over `COCHANGE_HISTORY_COMMITS` (200)
- Errors: `INVALID`, `NOT_A_REPOSITORY`
- Output: `unmodified_co_changes` with `file`, `co_change_frequency` (2 decimals), `reason` (`Modified in X out of last Y commits affecting <path>`)
- `P(B|A) = commits touching both / commits touching A`

### Tool detail — `calculate_change_risk_score`
- Required params: none
- Optional params (defaults): `target_branch` omitted detects the repo default (`origin/HEAD`, else `main`, else `master`, else `HEAD`)
- Caps / truncation: factors capped then total clamped 0..100
- Errors: `INVALID`, `NOT_A_REPOSITORY`
- Output: `risk_score`, `risk_level`, `depth_points`, `api_points`, `test_gap_points`, `forgotten_points`
- Formula (ADR-007): depth `min(30, 10 * max(0, deepestImpactDepth - 2))`; API `min(25, 15 * alteredBoundaryRouteCount)`; tests `25` if any modified symbol has zero linked tests else `0`; forgotten `20` if any omitted co-change file has frequency `>= 0.70` and support `>= 5` else `0`. Bands: 0–24 LOW, 25–49 MEDIUM, 50–74 HIGH, 75–100 CRITICAL.

### Tool detail — `simulate_migration_lock_impact`
- Required params: `migration_file_path`
- Optional params (defaults): none
- Caps / truncation: file read through WorkspacePort only
- Errors: `INVALID`, `PATH_ESCAPE`
- Findings: `REWRITE`, `LOCK_WRITES`, `CDC_BREAK`, `INDEX_GAP`
- `lock_risk` HIGH when any of `REWRITE`, `LOCK_WRITES`, `CDC_BREAK` exist, else LOW
- Must not import `node:sqlite` or execute the SQL text.

## Deferred (v2)
| Item | Why deferred |
|------|----------------|
| HTTP MCP transport | No auth story; stdio only (ADR-003) |
| Rename detection | Line-based ids look like add+remove (R2) |
| Invented edges for dynamic calls | Count `unresolved_calls` instead (R1) |
| Live schema fetch / SQL execution | Static tools only (ADR-014) |
| Resources / Prompts | tools-only v1 |

## Security notes
- Untrusted content handling: treat repo text and diffs as untrusted; jail paths with realpath; cap diffs at 200000 chars; never echo full files; never print `process.env` values; stderr logs `tool`, `status`, `duration_ms` only (no diff bodies).
- Destructive gates: none — no source writes; cache confined to `.mcp/`.
- Least privilege: no network, no tokens, optional `BLAST_RADIUS_ROOT` only.
- Ignore directories: `node_modules`, `dist`, `build`, `coverage`, `.git`, `.mcp`, `vendor`, `target`, `__pycache__`, `.next`, `.turbo`.
- Git: `execFile` argument arrays, timeout `GIT_TIMEOUT_MS` 30000, no shell.

## Verification
- [x] unit tests per tool
- [x] test-connections script
- [x] build + CI
- [x] annotations present
- [x] schema sync checked
- [x] `mcp-maker qc` PASS (or WARN accepted)
- [x] agent audit checklist complete
