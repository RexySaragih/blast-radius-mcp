export const ERROR_CODES = [
  'INVALID',
  'PATH_ESCAPE',
  'DIFF_TOO_LARGE',
  'NOT_A_REPOSITORY',
  'UNSUPPORTED_RUNNER',
  'UNSUPPORTED_LANGUAGE',
  'SYMBOL_NOT_FOUND',
  'SPEC_NOT_FOUND',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class BlastRadiusError extends Error {
  constructor(
    readonly code: ErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'BlastRadiusError';
  }
}

export function isErrorCode(value: string): value is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(value);
}
