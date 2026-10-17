import type { ApiErrorCode } from '@faceless-automations/platform-contracts';

export class HttpError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}
