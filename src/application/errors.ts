import { BlastRadiusError, type ErrorCode } from '../domain/errors.js';

export class ApplicationError extends BlastRadiusError {
  constructor(code: ErrorCode, message?: string) {
    super(code, message);
    this.name = 'ApplicationError';
  }
}

export { BlastRadiusError };
export type { ErrorCode };
