import { ApplicationError } from '../errors.js';
import type {
  EnvReachOutput,
  EnvReachSite,
  TraceEnvInput,
  TraceEnvVariableReach,
} from '../ports/inbound/TraceEnvVariableReach.js';
import type { WorkspacePort } from '../ports/outbound/WorkspacePort.js';

const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;

export class TraceEnvVariableReachUseCase implements TraceEnvVariableReach {
  constructor(private readonly workspace: WorkspacePort) {}

  async execute(input: TraceEnvInput): Promise<EnvReachOutput> {
    if (!ENV_NAME.test(input.env_var_name)) {
      throw new ApplicationError('INVALID', 'env_var_name');
    }
    const name = input.env_var_name;
    const sites: EnvReachSite[] = [];
    for (const relativePath of this.workspace.listSourceFiles()) {
      let source: string;
      try {
        source = this.workspace.readText(relativePath);
      } catch {
        continue;
      }
      // Never read process.env[name] — only scan source text patterns
      const patterns = [
        new RegExp(String.raw`process\.env\.${name}\b`, 'g'),
        new RegExp(String.raw`process\.env\[["']${name}["']\]`, 'g'),
        new RegExp(String.raw`os\.Getenv\(["']${name}["']\)`, 'g'),
        new RegExp(String.raw`os\.getenv\(["']${name}["']\)`, 'g'),
        new RegExp(String.raw`System\.getenv\(["']${name}["']\)`, 'g'),
        new RegExp(String.raw`\benv\.${name}\b`, 'g'),
        new RegExp(String.raw`\benv\[["']${name}["']\]`, 'g'),
      ];
      const lines = source.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? '';
        for (const pattern of patterns) {
          pattern.lastIndex = 0;
          if (pattern.test(line)) {
            sites.push({
              file: relativePath,
              line: i + 1,
              snippet: redactEnvValue(line, name),
            });
            break;
          }
        }
      }
    }
    return { env_var_name: name, sites };
  }
}

function redactEnvValue(line: string, name: string): string {
  // Keep the identifier, never interpolate live env values
  return line.replace(/\s+/g, ' ').trim().includes(name) ? line.trim() : `${name}`;
}
