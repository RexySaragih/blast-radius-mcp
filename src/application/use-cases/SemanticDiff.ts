import type { SymbolNode } from '../../domain/Symbol.js';
import type { ParseResult } from '../ports/outbound/SourceParserPort.js';

export type ChangeKind = 'added' | 'removed' | 'signature_modified' | 'body_modified';

export type SymbolChange = {
  symbol: SymbolNode;
  kind: ChangeKind;
};

export type SemanticDiffInput = {
  before: ParseResult;
  after: ParseResult;
};

export type SemanticDiffOutput = {
  modifiedSymbols: SymbolChange[];
};

export class SemanticDiff {
  execute(input: SemanticDiffInput): SemanticDiffOutput {
    const beforeById = new Map(input.before.symbols.map((symbol) => [symbol.id, symbol]));
    const afterById = new Map(input.after.symbols.map((symbol) => [symbol.id, symbol]));
    const modifiedSymbols: SymbolChange[] = [];

    for (const [id, afterSymbol] of afterById) {
      const beforeSymbol = beforeById.get(id);
      if (!beforeSymbol) {
        modifiedSymbols.push({ symbol: afterSymbol, kind: 'added' });
        continue;
      }
      const kind = classifyChange(beforeSymbol, afterSymbol);
      if (kind) modifiedSymbols.push({ symbol: afterSymbol, kind });
    }

    for (const [id, beforeSymbol] of beforeById) {
      if (afterById.has(id)) continue;
      modifiedSymbols.push({ symbol: beforeSymbol, kind: 'removed' });
    }

    return { modifiedSymbols };
  }
}

function classifyChange(before: SymbolNode, after: SymbolNode): ChangeKind | null {
  const signatureChanged = before.signatureHash !== after.signatureHash;
  const bodyChanged = before.bodyHash !== after.bodyHash;
  if (signatureChanged) return 'signature_modified';
  if (bodyChanged) return 'body_modified';
  return null;
}
