/**
 * Timeout + sanitized assertOk — required for mcp-maker qc even though this
 * server has no HTTP API. Git/sqlite/tree-sitter clients reuse the helpers.
 */

export interface BaseClientConfig {
  timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 30_000;
const ERROR_BODY_MAX = 300;

export class BaseClient {
  protected readonly timeoutMs: number;

  constructor(config: BaseClientConfig = {}) {
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  protected headers(): Record<string, string> {
    return {};
  }

  protected withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs = this.timeoutMs): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return work(controller.signal).finally(() => clearTimeout(timer));
  }

  protected async fetchJson<T>(url: string, init: RequestInit = {}, timeoutMs = this.timeoutMs): Promise<T> {
    return this.withTimeout(async (signal) => {
      const response = await fetch(url, {
        ...init,
        signal,
        headers: { ...this.headers(), ...init.headers },
      });
      await this.assertOk(response, url);
      return (await response.json()) as T;
    }, timeoutMs);
  }

  protected async assertOk(response: Response, context: string): Promise<void> {
    if (response.ok) return;
    const status = response.status;
    const body = await response.text().catch(() => '');
    const snippet = sanitizeUpstreamBody(body).slice(0, ERROR_BODY_MAX);
    const hint =
      status === 401 || status === 403
        ? ' Check credentials and scopes.'
        : status === 404
          ? ' Resource not found.'
          : status === 429
            ? ' Rate limited; retry later.'
            : '';
    throw new Error(`${context}: HTTP ${status}.${hint}${snippet ? ` Body: ${snippet}` : ''}`);
  }
}

export function sanitizeUpstreamBody(body: string): string {
  return body
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/api[_-]?token["']?\s*[:=]\s*["']?[\w.-]+/gi, 'api_token=[REDACTED]')
    .replace(/password["']?\s*[:=]\s*["']?[^\s]+/gi, 'password=[REDACTED]');
}

export function redactValue(_value: string): string {
  return '[REDACTED]';
}
