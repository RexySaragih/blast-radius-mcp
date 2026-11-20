# blast-radius-mcp

Local MCP server that maps a code change to callers, boundaries, tests, co-changed files, and a clamped risk score. It indexes the workspace with Tree-sitter and SQLite, then answers eight read-only tools over stdio.

## Requirements

- Node.js `>=22`

## Install

Node.js `>=22`. Add this to Cursor or Claude `mcp.json`. `npx` downloads the package on first launch:

```json
{
  "mcpServers": {
    "blast-radius": {
      "command": "npx",
      "args": ["-y", "@rexy_mayderio/blast-radius-mcp"],
      "env": {
        "BLAST_RADIUS_ROOT": "/absolute/path/to/your/repo"
      }
    }
  }
}
```

Restart the MCP server after saving that file.

## Workspace root

The repo to index is chosen once, when the process starts. Paths such as `source_file`, `spec_path`, and `migration_file_path` are relative to that root.

Set it with `BLAST_RADIUS_ROOT` in the MCP client env. To point the same server at another repo, change the variable and restart the process.

Resolution order:

1. `BLAST_RADIUS_ROOT`, when it is set and not empty.
2. `git rev-parse --show-toplevel` from the process working directory.
3. The process working directory.

Cursor launches MCP servers from its own working directory, so set `BLAST_RADIUS_ROOT` there. The git and cwd fallbacks apply when you start the process inside the repo.

## Develop this repo

```bash
npm install
npm run build
```

To run a local checkout instead of the published package, point `command` at `node` and `args` at `dist/index.js` inside that checkout. Keep `BLAST_RADIUS_ROOT` on the repo you want indexed.

## Cache

The server may write a derived symbol graph at `{root}/.mcp/blast_radius.db` (SQLite WAL). Another process waits up to 30 seconds for that file instead of exiting on `database is locked`. The path is gitignored. Tools do not edit source files or git objects.

## Secrets and scope

- Put configuration in the agent **mcp.json `env`** block — **not project `.env`**. This server does not load dotenv.
- `BLAST_RADIUS_ROOT` is set via mcp.json `env`. Tool arguments are paths inside that root.
- Scope: local workspace indexing and eight stdio tools only. No network I/O, no SaaS auth tokens, no source edits. Residual risk: the process reads local source and git history for the chosen root.

## Safety notes

- Tools never execute tests (`vitest` / `jest` / `pytest` / `go test` / `node --test` strings are returned only).
- Migration analysis never connects to a database and never executes SQL.
- Env tracing never prints live `process.env` values.
- Untrusted diffs are capped; paths are realpath-jailed inside the workspace root.

## Scripts

```bash
npm test
npm run build
npm run depcruise
npm run test:connections
```

`test:connections` builds, then traces `AuthService.validateSession` in the local auth fixture.
