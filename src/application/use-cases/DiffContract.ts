import { parseProtobuf } from '../../languages/proto.js';
import { ApplicationError } from '../errors.js';
import type {
  ContractDriftItem,
  ContractDriftOutput,
  DiffContractAgainstSpec,
  DiffContractInput,
} from '../ports/inbound/DiffContractAgainstSpec.js';
import type { GraphStorePort } from '../ports/outbound/GraphStorePort.js';
import type { WorkspacePort } from '../ports/outbound/WorkspacePort.js';
import type { IndexWorkspaceUseCase } from './IndexWorkspace.js';

const PROPERTY_TYPE_WINDOW = 4;
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
const IMPLEMENTATION_FILE = /\.(ts|tsx|js|jsx|py|go|java)$/i;

type Scalar = 'string' | 'number' | 'integer' | 'boolean';

const SCALAR_BY_NAME: Record<string, Scalar> = {
  string: 'string',
  String: 'string',
  str: 'string',
  bytes: 'string',
  number: 'number',
  Number: 'number',
  float: 'number',
  Float: 'number',
  double: 'number',
  Double: 'number',
  integer: 'integer',
  Integer: 'integer',
  int: 'integer',
  int32: 'integer',
  int64: 'integer',
  Int: 'integer',
  uint32: 'integer',
  uint64: 'integer',
  sint32: 'integer',
  boolean: 'boolean',
  Boolean: 'boolean',
  bool: 'boolean',
  Bool: 'boolean',
};

export class DiffContractUseCase implements DiffContractAgainstSpec {
  constructor(
    private readonly workspace: WorkspacePort,
    private readonly graph: GraphStorePort,
    private readonly indexer: IndexWorkspaceUseCase,
  ) {}

  async execute(input: DiffContractInput): Promise<ContractDriftOutput> {
    const abs = this.workspace.resolveInsideRoot(input.spec_path);
    const relative = this.workspace.relativePath(abs);
    if (!this.workspace.exists(relative)) {
      throw new ApplicationError('SPEC_NOT_FOUND', input.spec_path);
    }
    this.indexer.execute();
    const controller = controllerFile(this.workspace, input.modified_controller);
    const source = this.workspace.readText(relative);
    const kind = detectKind(relative);
    const code = codeFields(this.graph, this.workspace, relative, controller);
    if (kind === 'openapi') return { kind, drifts: diffOpenApi(source, this.graph, code, controller) };
    if (kind === 'graphql') return { kind, drifts: diffNamed(graphqlFields(source), code) };
    return { kind: 'protobuf', drifts: diffNamed(protoFields(source), code) };
  }
}

function controllerFile(workspace: WorkspacePort, modifiedController: string | undefined): string | null {
  if (!modifiedController) return null;
  const relative = workspace.relativePath(workspace.resolveInsideRoot(modifiedController));
  if (!workspace.exists(relative)) throw new ApplicationError('INVALID', 'modified_controller');
  return relative;
}

function detectKind(path: string): 'openapi' | 'graphql' | 'protobuf' {
  const lower = path.toLowerCase();
  if (lower.endsWith('.proto')) return 'protobuf';
  if (lower.endsWith('.graphql') || lower.endsWith('.gql')) return 'graphql';
  return 'openapi';
}

function diffOpenApi(
  source: string,
  graph: GraphStorePort,
  code: Map<string, Scalar | null>,
  controller: string | null,
): ContractDriftItem[] {
  const specRoutes = openApiRoutes(source);
  const implemented = codeRoutes(graph, controller);
  const drifts = diffSets(implemented, specRoutes);
  drifts.push(...typeMismatches(openApiProperties(source), code));
  return drifts;
}

function openApiRoutes(source: string): Set<string> {
  const routes = new Set<string>();
  let currentPath: string | null = null;
  let pathIndent = -1;
  for (const line of source.split('\n')) {
    const pathMatch = line.match(/^(\s*)(\/[^\s:#]+)\s*:/);
    if (pathMatch?.[2]) {
      currentPath = pathMatch[2];
      pathIndent = (pathMatch[1] ?? '').length;
      continue;
    }
    if (!currentPath) continue;
    const methodMatch = line.match(/^(\s*)([A-Za-z]+)\s*:/);
    if (!methodMatch) continue;
    const indent = (methodMatch[1] ?? '').length;
    const method = (methodMatch[2] ?? '').toLowerCase();
    if (indent <= pathIndent) {
      currentPath = null;
      continue;
    }
    if (HTTP_METHODS.has(method)) routes.add(`${method.toUpperCase()} ${currentPath}`);
  }
  for (const match of source.matchAll(/"(\/[^"]+)"\s*:\s*\{([^}]*)\}/g)) {
    const routePath = match[1] ?? '';
    for (const method of (match[2] ?? '').matchAll(/"(get|post|put|patch|delete|head|options)"/gi)) {
      if (method[1]) routes.add(`${method[1].toUpperCase()} ${routePath}`);
    }
  }
  return routes;
}

function openApiProperties(source: string): Map<string, Scalar | null> {
  const properties = new Map<string, Scalar | null>();
  const lines = source.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const name = lines[index]?.match(/^\s+([A-Za-z_]\w*)\s*:/)?.[1];
    if (!name || HTTP_METHODS.has(name.toLowerCase())) continue;
    const window = lines.slice(index, index + PROPERTY_TYPE_WINDOW).join('\n');
    const declared = window.match(/\btype\s*:\s*(string|number|integer|boolean)\b/)?.[1];
    if (!declared) continue;
    remember(properties, name, scalarOf(declared));
  }
  return properties;
}

function codeRoutes(graph: GraphStorePort, controller: string | null): Set<string> {
  const routes = new Set<string>();
  for (const symbol of graph.listSymbols()) {
    if (controller && symbol.filePath !== controller) continue;
    if (!symbol.routeLabel) continue;
    const normalized = normalizeRoute(symbol.routeLabel);
    if (normalized) routes.add(normalized);
  }
  return routes;
}

function normalizeRoute(label: string): string | null {
  const match = label.trim().match(/^([A-Za-z]+)\s+(\/\S+)$/);
  if (!match?.[1] || !match[2]) return null;
  return `${match[1].toUpperCase()} ${match[2]}`;
}

function graphqlFields(source: string): Map<string, Scalar | null> {
  const fields = new Map<string, Scalar | null>();
  for (const match of source.matchAll(/(?:type|input)\s+\w+\s*\{([^}]*)\}/g)) {
    for (const field of (match[1] ?? '').matchAll(/^\s*(\w+)\s*(?:\([^)]*\))?\s*:\s*([A-Za-z_]\w+)/gm)) {
      if (!field[1]) continue;
      remember(fields, field[1], scalarOf(field[2] ?? null));
    }
  }
  return fields;
}

function protoFields(source: string): Map<string, Scalar | null> {
  const fields = new Map<string, Scalar | null>();
  for (const field of parseProtobuf(source).fields) {
    remember(fields, field.name, scalarOf(field.type));
  }
  return fields;
}

function codeFields(
  graph: GraphStorePort,
  workspace: WorkspacePort,
  specPath: string,
  controller: string | null,
): Map<string, Scalar | null> {
  const fields = new Map<string, Scalar | null>();
  const files = new Set(graph.listSymbols().map((symbol) => symbol.filePath));
  for (const filePath of files) {
    if (controller && filePath !== controller) continue;
    if (filePath === specPath || !IMPLEMENTATION_FILE.test(filePath) || !workspace.exists(filePath)) continue;
    collectSourceFields(workspace.readText(filePath), fields);
  }
  return fields;
}

function collectSourceFields(source: string, fields: Map<string, Scalar | null>): void {
  for (const match of source.matchAll(
    /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*(?::\s*([A-Za-z_]\w*))?/g,
  )) {
    if (match[1]) remember(fields, match[1], scalarOf(match[2] ?? null));
  }
  for (const block of source.matchAll(/(?:export\s+)?(?:type|interface)\s+\w+[^{]*\{([^}]*)\}/g)) {
    for (const field of (block[1] ?? '').matchAll(/^\s*(\w+)\??\s*:\s*([A-Za-z_]\w+)/gm)) {
      if (field[1]) remember(fields, field[1], scalarOf(field[2] ?? null));
    }
  }
}

function diffNamed(spec: Map<string, Scalar | null>, code: Map<string, Scalar | null>): ContractDriftItem[] {
  const drifts: ContractDriftItem[] = [];
  for (const [name, codeScalar] of code) {
    if (!spec.has(name)) {
      drifts.push({ code: 'MISSING_IN_SPEC', name, detail: name });
      continue;
    }
    const specScalar = spec.get(name) ?? null;
    if (specScalar && codeScalar && specScalar !== codeScalar) {
      drifts.push({ code: 'TYPE_MISMATCH', name, detail: `${specScalar} vs ${codeScalar}` });
    }
  }
  for (const name of spec.keys()) {
    if (!code.has(name)) drifts.push({ code: 'MISSING_IN_CODE', name, detail: name });
  }
  return drifts.sort((left, right) => left.name.localeCompare(right.name));
}

function diffSets(code: Set<string>, spec: Set<string>): ContractDriftItem[] {
  const drifts: ContractDriftItem[] = [];
  for (const label of code) {
    if (!spec.has(label)) drifts.push({ code: 'MISSING_IN_SPEC', name: label, detail: label });
  }
  for (const label of spec) {
    if (!code.has(label)) drifts.push({ code: 'MISSING_IN_CODE', name: label, detail: label });
  }
  return drifts.sort((left, right) => left.name.localeCompare(right.name));
}

function typeMismatches(spec: Map<string, Scalar | null>, code: Map<string, Scalar | null>): ContractDriftItem[] {
  const drifts: ContractDriftItem[] = [];
  for (const [name, specScalar] of spec) {
    const codeScalar = code.get(name) ?? null;
    if (!specScalar || !codeScalar || specScalar === codeScalar) continue;
    drifts.push({ code: 'TYPE_MISMATCH', name, detail: `${specScalar} vs ${codeScalar}` });
  }
  return drifts;
}

function remember(fields: Map<string, Scalar | null>, name: string, scalar: Scalar | null): void {
  const current = fields.get(name);
  if (current === undefined || (current === null && scalar)) fields.set(name, scalar);
}

function scalarOf(typeName: string | null): Scalar | null {
  if (!typeName) return null;
  return SCALAR_BY_NAME[typeName] ?? null;
}
