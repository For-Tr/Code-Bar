export type ErrorCode =
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_REJECTED"
  | "PROVIDER_BINDING_FAILED"
  | "GIT_OPERATION_FAILED"
  | "FILE_VERSION_CONFLICT"
  | "INTERNAL";

export interface ErrorEnvelope {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}
