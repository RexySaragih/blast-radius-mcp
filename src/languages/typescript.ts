import { createSymbol, semanticHash, type SymbolKind, type SymbolNode } from '../domain/Symbol.js';

export type JsFamilyLanguage = 'typescript' | 'tsx' | 'javascript';

export type ExtractedRef = {
  kind: 'call' | 'import' | 'implements' | 'publish' | 'query';
  name: string;
  fromSymbolId: string | null;
  sourceFile: string;
  targetFile: string | null;
  importedNames: string[];
  dynamic: boolean;
  line: number;
  column: number;
};

export type AstNode = {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  namedChildCount: number;
  namedChild(index: number): AstNode | null;
  childForFieldName(name: string): AstNode | null;
};

export type ExtractOutput = {
  symbols: SymbolNode[];
  rawRefs: ExtractedRef[];
};

const EXTENSION_LANGUAGE: Record<string, JsFamilyLanguage> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascript',
};

export function detectJsFamilyLanguage(filePath: string): JsFamilyLanguage | null {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.d.ts')) return 'typescript';
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return null;
  return EXTENSION_LANGUAGE[lower.slice(dot)] ?? null;
}

export function extractTypescriptFamily(
  root: AstNode,
  filePath: string,
  language: JsFamilyLanguage,
): ExtractOutput {
  const symbols: SymbolNode[] = [];
  const rawRefs: ExtractedRef[] = [];
  const loaders = new Map<string, string>();
  collectLoaders(root, loaders);
  walk(root, filePath, language, null, null, symbols, rawRefs, loaders);
  return { symbols, rawRefs };
}

/** @deprecated Prefer extractTypescriptFamily */
export function extractTypescriptFamilySymbols(
  root: AstNode,
  filePath: string,
  language: JsFamilyLanguage,
): SymbolNode[] {
  return extractTypescriptFamily(root, filePath, language).symbols;
}

function walk(
  node: AstNode,
  filePath: string,
  language: JsFamilyLanguage,
  enclosingClass: string | null,
  enclosingSymbol: SymbolNode | null,
  symbols: SymbolNode[],
  rawRefs: ExtractedRef[],
  loaders: Map<string, string>,
): void {
  if (node.type === 'import_statement') {
    collectImport(node, filePath, rawRefs);
    return;
  }

  if (node.type === 'export_statement') {
    collectReexport(node, filePath, rawRefs);
    for (let i = 0; i < node.namedChildCount; i += 1) {
      const child = node.namedChild(i);
      if (child) walk(child, filePath, language, enclosingClass, enclosingSymbol, symbols, rawRefs, loaders);
    }
    return;
  }

  if (node.type === 'class_declaration') {
    const className = identifierText(node.childForFieldName('name')) ?? unnamedLabel(node);
    const classSymbol = toSymbol(node, className, 'class', filePath, language);
    symbols.push(classSymbol);
    collectImplements(node, filePath, classSymbol, rawRefs);
    for (let i = 0; i < node.namedChildCount; i += 1) {
      const child = node.namedChild(i);
      if (child) walk(child, filePath, language, className, classSymbol, symbols, rawRefs, loaders);
    }
    return;
  }

  if (node.type === 'method_definition') {
    const methodName = identifierText(node.childForFieldName('name')) ?? unnamedLabel(node);
    const qualified = enclosingClass ? `${enclosingClass}.${methodName}` : methodName;
    const methodSymbol = toSymbol(node, qualified, 'function', filePath, language);
    symbols.push(methodSymbol);
    const body = node.childForFieldName('body');
    if (body) walk(body, filePath, language, enclosingClass, methodSymbol, symbols, rawRefs, loaders);
    return;
  }

  if (node.type === 'function_declaration') {
    const name = identifierText(node.childForFieldName('name')) ?? unnamedLabel(node);
    const fnSymbol = toSymbol(node, name, 'function', filePath, language);
    symbols.push(fnSymbol);
    const body = node.childForFieldName('body');
    if (body) walk(body, filePath, language, enclosingClass, fnSymbol, symbols, rawRefs, loaders);
    return;
  }

  if (node.type === 'interface_declaration') {
    const name = identifierText(node.childForFieldName('name')) ?? unnamedLabel(node);
    symbols.push(toSymbol(node, name, 'interface', filePath, language));
    return;
  }

  if (node.type === 'type_alias_declaration') {
    const name = identifierText(node.childForFieldName('name')) ?? unnamedLabel(node);
    symbols.push(toSymbol(node, name, 'interface', filePath, language));
    return;
  }

  if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
    collectExportedArrows(node, filePath, language, enclosingClass, symbols, rawRefs, loaders);
    for (let i = 0; i < node.namedChildCount; i += 1) {
      const declarator = node.namedChild(i);
      if (!declarator || declarator.type !== 'variable_declarator') continue;
      collectBoundImport(declarator, filePath, rawRefs, loaders);
      const value = declarator.childForFieldName('value');
      if (!value || value.type === 'arrow_function') continue;
      walk(value, filePath, language, enclosingClass, enclosingSymbol, symbols, rawRefs, loaders);
    }
    return;
  }

  if (node.type === 'call_expression') {
    const callback = testCallback(node);
    if (callback) {
      const testSymbol = toSymbol(callback, testLabel(node), 'test', filePath, language);
      symbols.push(testSymbol);
      const body = callback.childForFieldName('body');
      if (body) walk(body, filePath, language, enclosingClass, testSymbol, symbols, rawRefs, loaders);
      return;
    }
    collectCall(node, filePath, enclosingSymbol, rawRefs);
  }

  for (let i = 0; i < node.namedChildCount; i += 1) {
    const child = node.namedChild(i);
    if (child) walk(child, filePath, language, enclosingClass, enclosingSymbol, symbols, rawRefs, loaders);
  }
}

function collectExportedArrows(
  declaration: AstNode,
  filePath: string,
  language: JsFamilyLanguage,
  enclosingClass: string | null,
  symbols: SymbolNode[],
  rawRefs: ExtractedRef[],
  loaders: Map<string, string>,
): void {
  for (let i = 0; i < declaration.namedChildCount; i += 1) {
    const declarator = declaration.namedChild(i);
    if (!declarator || declarator.type !== 'variable_declarator') continue;
    const nameNode = declarator.childForFieldName('name');
    const value = declarator.childForFieldName('value');
    if (!nameNode || !value || value.type !== 'arrow_function') continue;
    const name = identifierText(nameNode);
    if (!name) continue;
    const fnSymbol = toSymbol(value, name, 'function', filePath, language);
    symbols.push(fnSymbol);
    const body = value.childForFieldName('body');
    if (body) walk(body, filePath, language, enclosingClass, fnSymbol, symbols, rawRefs, loaders);
  }
}

function collectLoaders(node: AstNode, loaders: Map<string, string>): void {
  if (node.type === 'function_declaration') {
    const name = identifierText(node.childForFieldName('name'));
    const body = node.childForFieldName('body');
    const imported = body ? returnedImportPath(body, loaders) : null;
    if (name && imported) loaders.set(name, imported);
  }
  for (let i = 0; i < node.namedChildCount; i += 1) {
    const child = node.namedChild(i);
    if (child) collectLoaders(child, loaders);
  }
}

function returnedImportPath(body: AstNode, loaders: Map<string, string>): string | null {
  for (let i = 0; i < body.namedChildCount; i += 1) {
    const statement = body.namedChild(i);
    if (!statement || statement.type !== 'return_statement') continue;
    return importPathFrom(statement.namedChild(0), loaders);
  }
  return null;
}

function collectBoundImport(
  declarator: AstNode,
  filePath: string,
  rawRefs: ExtractedRef[],
  loaders: Map<string, string>,
): void {
  const names = bindingNames(declarator.childForFieldName('name'));
  const targetFile = importPathFrom(declarator.childForFieldName('value'), loaders);
  if (names.length === 0 || !targetFile) return;
  rawRefs.push({
    kind: 'import',
    name: names.join(','),
    fromSymbolId: null,
    sourceFile: filePath,
    targetFile,
    importedNames: names,
    dynamic: true,
    line: declarator.startPosition.row + 1,
    column: declarator.startPosition.column,
  });
}

function bindingNames(pattern: AstNode | null): string[] {
  if (!pattern || pattern.type !== 'object_pattern') return [];
  const names: string[] = [];
  for (let i = 0; i < pattern.namedChildCount; i += 1) {
    const child = pattern.namedChild(i);
    if (!child) continue;
    if (
      child.type === 'shorthand_property_identifier_pattern' ||
      child.type === 'shorthand_property_identifier'
    ) {
      names.push(child.text);
      continue;
    }
    if (child.type !== 'pair_pattern') continue;
    const alias = identifierText(child.childForFieldName('value') ?? child.namedChild(1));
    if (alias) names.push(alias);
  }
  return names;
}

function importPathFrom(node: AstNode | null, loaders: Map<string, string>): string | null {
  if (!node) return null;
  if (node.type === 'await_expression' || node.type === 'parenthesized_expression') {
    return importPathFrom(node.namedChild(0), loaders);
  }
  if (node.type !== 'call_expression') return null;
  const callee = node.childForFieldName('function');
  if (!callee) return null;
  if (isImportCallee(callee)) return moduleSpecifier(node);
  if (callee.type === 'identifier') return loaders.get(callee.text) ?? null;
  return null;
}

function isImportCallee(callee: AstNode): boolean {
  return callee.text === 'import';
}

function moduleSpecifier(call: AstNode): string | null {
  const args = call.childForFieldName('arguments') ?? call;
  const literals = [...namedDescendants(args)]
    .filter((node) => node.type === 'string')
    .map((node) => stripQuotes(node.text));
  return (
    literals.find((value) => value.includes('/') || /\.(?:[cm]?[jt]sx?)$/u.test(value)) ??
    literals[0] ??
    null
  );
}

function testCallback(node: AstNode): AstNode | null {
  const callee = node.childForFieldName('function');
  if (!callee || callee.type !== 'identifier' || (callee.text !== 'test' && callee.text !== 'it')) return null;
  const args = node.childForFieldName('arguments');
  if (!args) return null;
  for (let i = 0; i < args.namedChildCount; i += 1) {
    const arg = args.namedChild(i);
    if (!arg) continue;
    if (arg.type === 'arrow_function' || arg.type === 'function_expression' || arg.type === 'function') return arg;
  }
  return null;
}

function testLabel(node: AstNode): string {
  const args = node.childForFieldName('arguments');
  const title = args
    ? [...namedDescendants(args)].find((child) => child.type === 'string')
    : undefined;
  if (title) return stripQuotes(title.text);
  return `test@${node.startPosition.row + 1}`;
}

function collectImport(node: AstNode, filePath: string, rawRefs: ExtractedRef[]): void {
  const source = [...namedDescendants(node)].find((child) => child.type === 'string');
  if (!source) return;
  const targetFile = stripQuotes(source.text);
  const importedNames: string[] = [];
  for (const child of namedDescendants(node)) {
    if (child.type !== 'import_specifier') continue;
    const name = identifierText(child.childForFieldName('name') ?? child.namedChild(0));
    if (name) importedNames.push(name);
  }
  const defaultImport = [...namedDescendants(node)].find(
    (child) => child.type === 'identifier' && child.text && !importedNames.includes(child.text),
  );
  // named imports only for linker ACs; default kept when present
  if (defaultImport && importedNames.length === 0) {
    importedNames.push(defaultImport.text);
  }
  rawRefs.push({
    kind: 'import',
    name: importedNames.join(',') || targetFile,
    fromSymbolId: null,
    sourceFile: filePath,
    targetFile,
    importedNames,
    dynamic: false,
    line: node.startPosition.row + 1,
    column: node.startPosition.column,
  });
}

function collectReexport(node: AstNode, filePath: string, rawRefs: ExtractedRef[]): void {
  const source = node.childForFieldName('source');
  if (!source) return;
  const targetFile = stripQuotes(source.text);
  for (let i = 0; i < node.namedChildCount; i += 1) {
    const clause = node.namedChild(i);
    if (!clause || clause.type !== 'export_clause') continue;
    for (let specifierIndex = 0; specifierIndex < clause.namedChildCount; specifierIndex += 1) {
      const specifier = clause.namedChild(specifierIndex);
      if (!specifier || specifier.type !== 'export_specifier') continue;
      const original = identifierText(specifier.childForFieldName('name'));
      const alias = identifierText(specifier.childForFieldName('alias'));
      const publicName = alias ?? original;
      if (!original || !publicName) continue;
      rawRefs.push({
        kind: 'import',
        name: original,
        fromSymbolId: null,
        sourceFile: filePath,
        targetFile,
        importedNames: [publicName],
        dynamic: false,
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
      });
    }
  }
}

function collectImplements(
  classNode: AstNode,
  filePath: string,
  classSymbol: SymbolNode,
  rawRefs: ExtractedRef[],
): void {
  for (const child of namedDescendants(classNode)) {
    if (child.type !== 'implements_clause') continue;
    for (let i = 0; i < child.namedChildCount; i += 1) {
      const typeNode = child.namedChild(i);
      const name = identifierText(typeNode);
      if (!name) continue;
      rawRefs.push({
        kind: 'implements',
        name,
        fromSymbolId: classSymbol.id,
        sourceFile: filePath,
        targetFile: filePath,
        importedNames: [],
        dynamic: false,
        line: typeNode?.startPosition.row != null ? typeNode.startPosition.row + 1 : classSymbol.startLine,
        column: typeNode?.startPosition.column ?? 0,
      });
    }
  }
}

function collectCall(
  node: AstNode,
  filePath: string,
  enclosingSymbol: SymbolNode | null,
  rawRefs: ExtractedRef[],
): void {
  const callee = node.childForFieldName('function') ?? node.namedChild(0);
  if (!callee || isImportCallee(callee)) return;
  const dynamic = callee.type === 'subscript_expression';
  let name = '';
  if (callee.type === 'identifier') {
    name = callee.text;
  } else if (callee.type === 'member_expression') {
    name = identifierText(callee.childForFieldName('property')) ?? callee.text;
  } else if (dynamic) {
    name = callee.text;
  } else {
    name = callee.text;
  }
  rawRefs.push({
    kind: 'call',
    name,
    fromSymbolId: enclosingSymbol?.id ?? null,
    sourceFile: filePath,
    targetFile: null,
    importedNames: [],
    dynamic,
    line: node.startPosition.row + 1,
    column: node.startPosition.column,
  });
}

function toSymbol(
  node: AstNode,
  name: string,
  kind: SymbolKind,
  filePath: string,
  language: JsFamilyLanguage,
): SymbolNode {
  const params = node.childForFieldName('parameters');
  const body = node.childForFieldName('body');
  return createSymbol({
    name,
    kind,
    filePath,
    startLine: node.startPosition.row + 1,
    startColumn: node.startPosition.column,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column,
    hash: semanticHash(node.text),
    signatureHash: semanticHash(params?.text ?? ''),
    bodyHash: semanticHash(body?.text ?? node.text),
    isBoundary: false,
    language,
  });
}

function identifierText(node: AstNode | null): string | null {
  if (!node) return null;
  if (
    node.type === 'identifier' ||
    node.type === 'property_identifier' ||
    node.type === 'type_identifier' ||
    node.type === 'constant'
  ) {
    return node.text;
  }
  return node.text || null;
}

function unnamedLabel(node: AstNode): string {
  return `<anonymous@${node.startPosition.row + 1}:${node.startPosition.column}>`;
}

function stripQuotes(text: string): string {
  return text.replace(/^['"]|['"]$/g, '');
}

function* namedDescendants(node: AstNode): Generator<AstNode> {
  for (let i = 0; i < node.namedChildCount; i += 1) {
    const child = node.namedChild(i);
    if (!child) continue;
    yield child;
    yield* namedDescendants(child);
  }
}
