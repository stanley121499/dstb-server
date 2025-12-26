export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export type ApiErrorDetail = Readonly<{
  path: string;
  message: string;
}>;

export type ApiErrorBody = Readonly<{
  error: Readonly<{
    code: ApiErrorCode;
    message: string;
    details: readonly ApiErrorDetail[];
  }>;
}>;

/**
 * Base typed error for returning the standard API error contract.
 *
 * This is intentionally explicit to avoid leaking internal error details.
 */
export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: ApiErrorCode;
  public readonly details: readonly ApiErrorDetail[];

  public constructor(args: {
    statusCode: number;
    code: ApiErrorCode;
    message: string;
    details?: readonly ApiErrorDetail[];
  }) {
    super(args.message);
    this.name = "ApiError";
    this.statusCode = args.statusCode;
    this.code = args.code;
    this.details = args.details ?? [];
  }
}

/**
 * Creates a validation error response with detail paths matching the API contract.
 */
export function validationError(args: {
  message: string;
  details: readonly ApiErrorDetail[];
}): ApiError {
  return new ApiError({
    statusCode: 400,
    code: "VALIDATION_ERROR",
    message: args.message,
    details: args.details
  });
}

/**
 * Creates a not-found error.
 */
export function notFoundError(message: string): ApiError {
  return new ApiError({
    statusCode: 404,
    code: "NOT_FOUND",
    message,
    details: []
  });
}

/**
 * Converts an ApiError into the authoritative wire format from `docs/15-api-contracts.md`.
 */
export function toApiErrorBody(err: ApiError): ApiErrorBody {
  return {
    error: {
      code: err.code,
      message: err.message,
      details: err.details
    }
  };
}





