import { NextResponse } from "next/server";
import type { ZodType } from "zod";

export function ok(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function forbidden(message = "Forbidden") {
  return badRequest(message, 403);
}

export function notFoundResponse(message = "Not found") {
  return badRequest(message, 404);
}

export async function parseRouteParams<T>(
  context: { params: Promise<Record<string, string | string[]>> },
  schema: ZodType<T>,
  errorLabel = "parameters"
): Promise<T | NextResponse> {
  const result = schema.safeParse(await context.params);
  if (!result.success) {
    return badRequest(`Invalid ${errorLabel}`);
  }
  return result.data;
}
