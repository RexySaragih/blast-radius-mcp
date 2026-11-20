import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SimulateMigrationLockImpactUseCase } from '../src/application/use-cases/SimulateMigrationLockImpact.js';
import { WorkspaceFiles } from '../src/clients/workspace-client.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function writeMigration(sql: string): { root: string; relative: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-radius-mig-'));
  tempDirs.push(root);
  const relative = 'migrations/001.sql';
  fs.mkdirSync(path.join(root, 'migrations'), { recursive: true });
  fs.writeFileSync(path.join(root, relative), sql, 'utf8');
  return { root, relative };
}

describe('Simulate Migration Lock Impact', () => {
  describe('when ALTER COLUMN TYPE is present', () => {
    it('should report lock_risk HIGH and REWRITE', async () => {
      const { root, relative } = writeMigration(
        'ALTER TABLE users ALTER COLUMN email TYPE varchar(100);\n',
      );
      const result = await new SimulateMigrationLockImpactUseCase(new WorkspaceFiles(root)).execute({
        migration_file_path: relative,
      });
      expect(result.lock_risk).toBe('HIGH');
      expect(result.findings).toContain('REWRITE');
    });
  });

  describe('when CREATE INDEX lacks CONCURRENTLY', () => {
    it('should report LOCK_WRITES', async () => {
      const { root, relative } = writeMigration('CREATE INDEX users_email ON users(email);\n');
      const result = await new SimulateMigrationLockImpactUseCase(new WorkspaceFiles(root)).execute({
        migration_file_path: relative,
      });
      expect(result.findings).toContain('LOCK_WRITES');
    });
  });

  describe('when a foreign key column is not in a CREATE INDEX list', () => {
    it('should report INDEX_GAP even if an earlier index exists', async () => {
      const { root, relative } = writeMigration(
        'CREATE INDEX users_email_idx ON users (email);\nALTER TABLE orders ADD FOREIGN KEY (user_id) REFERENCES users(id);\n',
      );
      const result = await new SimulateMigrationLockImpactUseCase(new WorkspaceFiles(root)).execute({
        migration_file_path: relative,
      });
      expect(result.findings).toContain('INDEX_GAP');
    });
  });

  describe('when the foreign key column is indexed', () => {
    it('should omit INDEX_GAP', async () => {
      const { root, relative } = writeMigration(
        'CREATE INDEX orders_user_idx ON orders (user_id);\nALTER TABLE orders ADD FOREIGN KEY (user_id) REFERENCES users(id);\n',
      );
      const result = await new SimulateMigrationLockImpactUseCase(new WorkspaceFiles(root)).execute({
        migration_file_path: relative,
      });
      expect(result.findings).not.toContain('INDEX_GAP');
    });
  });

  describe('when inspecting the use case source', () => {
    it('should not import node:sqlite or execute SQL', () => {
      const source = fs.readFileSync(
        path.resolve('src/application/use-cases/SimulateMigrationLockImpact.ts'),
        'utf8',
      );
      expect(source).not.toContain('node:sqlite');
      expect(source).not.toMatch(/DatabaseSync|better-sqlite3|\.exec\(/);
    });
  });
});
