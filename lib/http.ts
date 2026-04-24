import { NextResponse } from "next/server";

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

export function tooManyRequests(message = "Too many requests", resetAt?: number) {
  const headers: Record<string, string> = {};
  if (resetAt) {
    headers["Retry-After"] = String(Math.ceil((resetAt - Date.now()) / 1000));
  }
  return NextResponse.json({ error: message }, { status: 429, headers });
}
