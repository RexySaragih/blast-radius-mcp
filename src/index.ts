#!/usr/bin/env node
import { startServer } from './composition/createRuntime.js';

startServer().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Failed to start MCP server';
  console.error(message);
  process.exit(1);
});
