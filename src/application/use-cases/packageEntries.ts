import type { WorkspacePort } from '../ports/outbound/WorkspacePort.js';

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'] as const;

type PackageManifest = {
  name?: string;
  main?: string;
  exports?: unknown;
};

export function readPackageEntries(workspace: WorkspacePort): Map<string, string> {
  const entries = new Map<string, string>();
  for (const filePath of workspace.listSourceFiles()) {
    if (!filePath.endsWith('package.json')) continue;
    let manifest: PackageManifest;
    try {
      manifest = JSON.parse(workspace.readText(filePath)) as PackageManifest;
    } catch {
      continue;
    }
    if (!manifest.name) continue;
    const entry = resolvePackageEntry(dirnamePosix(filePath), manifest, (relativePath) =>
      workspace.exists(relativePath),
    );
    if (entry) entries.set(manifest.name, entry);
  }
  return entries;
}

function resolvePackageEntry(
  packageDir: string,
  manifest: PackageManifest,
  exists: (relativePath: string) => boolean,
): string | null {
  const declared = declaredEntry(manifest) ?? 'src/index.ts';
  for (const candidate of sourceCandidates(packageDir, declared)) {
    if (exists(candidate)) return candidate;
  }
  return null;
}

function declaredEntry(manifest: PackageManifest): string | null {
  const fromExports = exportSpecifier(manifest.exports);
  if (fromExports) return fromExports;
  return manifest.main ?? null;
}

function exportSpecifier(exportsValue: unknown): string | null {
  if (typeof exportsValue === 'string') return exportsValue;
  if (!exportsValue || typeof exportsValue !== 'object') return null;
  const root = (exportsValue as Record<string, unknown>)['.'];
  if (typeof root === 'string') return root;
  if (!root || typeof root !== 'object') return null;
  const record = root as Record<string, unknown>;
  const selected = record.import ?? record.default ?? record.types;
  return typeof selected === 'string' ? selected : null;
}

function sourceCandidates(packageDir: string, declared: string): string[] {
  const normalized = declared.replace(/^\.\//u, '');
  const stems = new Set<string>([
    stripScriptExtension(normalized.replace(/^dist\//u, 'src/')),
    stripScriptExtension(normalized),
    'src/index',
  ]);
  const candidates: string[] = [];
  for (const stem of stems) {
    for (const extension of SOURCE_EXTENSIONS) {
      candidates.push(joinPosix(packageDir, `${stem}${extension}`));
    }
  }
  return candidates;
}

function stripScriptExtension(filePath: string): string {
  return filePath.replace(/\.(d\.ts|ts|tsx|js|jsx|mts|cts|mjs|cjs)$/u, '');
}

function dirnamePosix(filePath: string): string {
  const index = filePath.lastIndexOf('/');
  return index <= 0 ? '.' : filePath.slice(0, index);
}

function joinPosix(left: string, right: string): string {
  if (left === '.' || left === '') return right.replace(/^\.\//u, '');
  return `${left.replace(/\/$/u, '')}/${right.replace(/^\.\//u, '')}`;
}
