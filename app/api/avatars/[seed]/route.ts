import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { ensureBotAvatarSvg } from "@/lib/bot-avatar-store";
import { badRequest, parseRouteParams } from "@/lib/http";

const SEED_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

const paramsSchema = z.object({
  seed: z
    .string()
    .transform((value) => (value.endsWith(".svg") ? value.slice(0, -4) : value))
    .refine((value) => SEED_PATTERN.test(value), "Invalid avatar seed")
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ seed: string }> }
) {
  await requireUser();
  const params = await parseRouteParams(context, paramsSchema, "avatar seed");
  if (params instanceof NextResponse) return params;

  const svg = await ensureBotAvatarSvg(params.seed);
  if (!svg) {
    return new Response("Avatar generation unavailable", {
      status: 503,
      headers: { "Cache-Control": "no-store" }
    });
  }

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=31536000, immutable"
    }
  });
}
