import type { ParseResult, SourceParserPort } from '../ports/outbound/SourceParserPort.js';

export type ExtractSymbolsInput = {
  filePath: string;
  source: string;
};

export class ExtractSymbols {
  constructor(private readonly parser: SourceParserPort) {}

  execute(input: ExtractSymbolsInput): ParseResult {
    return this.parser.parse(input.filePath, input.source);
  }
}
