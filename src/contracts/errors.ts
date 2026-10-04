export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function notFound(message = "That record is not available."): AppError {
  return new AppError(404, "NOT_FOUND", message);
}

export function forbidden(message = "You do not have authority for that action.", code = "FORBIDDEN"): AppError {
  return new AppError(403, code, message);
}

export function conflict(code: string, message: string, details?: Record<string, unknown>): AppError {
  return new AppError(409, code, message, details);
}

export function invalid(code: string, message: string, details?: Record<string, unknown>): AppError {
  return new AppError(422, code, message, details);
}

export function unavailable(code: string, message: string): AppError {
  return new AppError(503, code, message);
}
