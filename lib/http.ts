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
