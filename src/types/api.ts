export type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UPSTREAM_ERROR"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export interface ApiErrorBody {
  ok: false;
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}

export interface ApiSuccessBody<T> {
  ok: true;
  data: T;
}

export type ApiResponseBody<T> = ApiSuccessBody<T> | ApiErrorBody;
