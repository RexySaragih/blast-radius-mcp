import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import Parser from 'web-tree-sitter';
import type { ParseResult, SourceParserPort } from '../application/ports/outbound/SourceParserPort.js';
import { extractGo } from '../languages/go.js';
import { extractJava } from '../languages/java.js';
import {
  detectJsFamilyLanguage,
  extractTypescriptFamily,
  type JsFamilyLanguage,
} from '../languages/index.js';
import { extractPython } from '../languages/python.js';
import { PARSE_TIMEOUT_MS } from '../domain/Limits.js';
import { BaseClient } from './base-client.js';

const require = createRequire(import.meta.url);

type LangKey = JsFamilyLanguage | 'python' | 'go' | 'java';

type LoadedLanguages = Partial<Record<LangKey, Parser.Language>>;

export class TreeSitterParser extends BaseClient implements SourceParserPort {
  private readonly languages: LoadedLanguages;
  private readonly parser: Parser;
  private readonly loadErrors: Map<string, string>;

  private constructor(
    languages: LoadedLanguages,
    loadErrors: Map<string, string>,
    timeoutMs = 30_000,
  ) {
    super({ timeoutMs });
    this.languages = languages;
    this.loadErrors = loadErrors;
    this.parser = new Parser();
  }

  static async create(timeoutMs = 30_000): Promise<TreeSitterParser> {
    await Parser.init();
    const wasmDir = path.join(path.dirname(require.resolve('tree-sitter-wasms/package.json')), 'out');
    const languages: LoadedLanguages = {};
    const loadErrors = new Map<string, string>();

    const load = async (key: LangKey, fileName: string): Promise<void> => {
      try {
        languages[key] = await Parser.Language.load(readWasm(wasmDir, fileName));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        loadErrors.set(key, `missing grammar ${fileName}: ${message}`);
      }
    };

    await load('typescript', 'tree-sitter-typescript.wasm');
    await load('tsx', 'tree-sitter-tsx.wasm');
    await load('javascript', 'tree-sitter-javascript.wasm');
    await load('python', 'tree-sitter-python.wasm');
    await load('go', 'tree-sitter-go.wasm');
    await load('java', 'tree-sitter-java.wasm');

    if (!languages.typescript || !languages.tsx || !languages.javascript) {
      throw new Error('Required TypeScript/JavaScript tree-sitter grammars failed to load');
    }
    return new TreeSitterParser(languages, loadErrors, timeoutMs);
  }

  supportedLanguages(): string[] {
    return Object.keys(this.languages);
  }

  grammarError(language: string): string | undefined {
    return this.loadErrors.get(language);
  }

  parse(filePath: string, source: string): ParseResult {
    const language = detectLanguage(filePath);
    if (!language) return emptyResult('unknown');

    const grammar = this.languages[language];
    if (!grammar) {
      const detail = this.loadErrors.get(language) ?? `missing grammar for ${language}`;
      throw new Error(detail);
    }

    try {
      this.parser.setLanguage(grammar);
      this.parser.setTimeoutMicros(PARSE_TIMEOUT_MS * 1000);
      const tree = this.parser.parse(source);
      if (language === 'python') {
        const extracted = extractPython(tree.rootNode, filePath);
        return toParseResult(extracted, language);
      }
      if (language === 'go') {
        const extracted = extractGo(tree.rootNode, filePath);
        return toParseResult(extracted, language);
      }
      if (language === 'java') {
        const extracted = extractJava(tree.rootNode, filePath, source);
        return toParseResult(extracted, language);
      }
      const extracted = extractTypescriptFamily(tree.rootNode, filePath, language);
      return toParseResult(extracted, language);
    } catch (error: unknown) {
      if (error instanceof Error && /missing grammar/i.test(error.message)) throw error;
      return emptyResult(language);
    }
  }
}

function detectLanguage(filePath: string): LangKey | null {
  const js = detectJsFamilyLanguage(filePath);
  if (js) return js;
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.py')) return 'python';
  if (lower.endsWith('.go')) return 'go';
  if (lower.endsWith('.java')) return 'java';
  return null;
}

function toParseResult(
  extracted: { symbols: ParseResult['symbols']; rawRefs: ParseResult['rawRefs'] },
  language: string,
): ParseResult {
  return {
    symbols: extracted.symbols,
    edges: [],
    unresolvedRefCount: extracted.rawRefs.filter((ref) => ref.kind === 'call' && ref.dynamic).length,
    rawRefs: extracted.rawRefs,
    language,
  };
}

function readWasm(wasmDir: string, fileName: string): Buffer {
  const full = path.join(wasmDir, fileName);
  if (!fs.existsSync(full)) {
    throw new Error(`wasm not found: ${fileName}`);
  }
  return fs.readFileSync(full);
}

function emptyResult(language: string): ParseResult {
  return {
    symbols: [],
    edges: [],
    unresolvedRefCount: 0,
    rawRefs: [],
    language,
  };
}
