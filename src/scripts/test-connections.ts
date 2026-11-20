import { runConnectionSmoke } from './smoke.js';

runConnectionSmoke().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
