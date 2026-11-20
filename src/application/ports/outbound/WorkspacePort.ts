export interface WorkspacePort {
  readonly root: string;
  resolveInsideRoot(inputPath: string): string;
  readText(relativePath: string): string;
  writeText?(relativePath: string, contents: string): void;
  listSourceFiles(): string[];
  fileSize(relativePath: string): number;
  exists(relativePath: string): boolean;
  relativePath(absolutePath: string): string;
  watch?(onChange: (relativePaths: string[]) => void): () => void;
}
