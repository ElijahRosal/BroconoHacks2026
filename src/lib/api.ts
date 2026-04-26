import { NextResponse } from "next/server";

import type { ApiErrorBody, ApiErrorCode, ApiSuccessBody } from "@/types/api";

export function apiSuccess<T>(data: T, status = 200) {
  return NextResponse.json<ApiSuccessBody<T>>(
    {
      ok: true,
      data,
    },
    { status }
  );
}

export function apiError(
  code: ApiErrorCode,
  message: string,
  status = 500,
  details?: unknown
) {
  const body: ApiErrorBody = {
    ok: false,
    error: {
      code,
      message,
      details,
    },
  };

  return NextResponse.json(body, { status });
}
