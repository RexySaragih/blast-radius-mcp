import type { ParseResult, SourceParserPort } from '../../../application/ports/outbound/SourceParserPort.js';

export class InMemoryParserAdapter implements SourceParserPort {
  private readonly byFile = new Map<string, ParseResult>();
  private readonly languages = ['typescript', 'javascript'];

  seed(filePath: string, result: ParseResult): void {
    this.byFile.set(filePath, result);
  }

  setLanguages(languages: string[]): void {
    this.languages.splice(0, this.languages.length, ...languages);
  }

  parse(filePath: string, _source: string): ParseResult {
    return (
      this.byFile.get(filePath) ?? {
        symbols: [],
        edges: [],
        unresolvedRefCount: 0,
        rawRefs: [],
        language: 'unknown',
      }
    );
  }

  supportedLanguages(): string[] {
    return [...this.languages];
  }
}
