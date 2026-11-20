import { IGNORE_DIR_NAMES, MAX_FILE_BYTES } from './Limits.js';

export const SOURCE_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.java',
  '.sql',
  '.prisma',
  '.graphql',
  '.gql',
  '.proto',
  '.yaml',
  '.yml',
  '.json',
]);

export function isIgnored(relativePath: string): boolean {
  const parts = relativePath.split(/[\\/]/u);
  return parts.some((part) => (IGNORE_DIR_NAMES as readonly string[]).includes(part));
}

export function exceedsMaxFileBytes(byteLength: number): boolean {
  return byteLength > MAX_FILE_BYTES;
}
