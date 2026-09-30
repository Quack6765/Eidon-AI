import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { getCuratorConfig, updateCuratorConfig } from "@/lib/skill-curator";
import { badRequest, ok } from "@/lib/http";

const updateSchema = z
  .object({
    enabled: z.boolean().optional(),
    intervalHours: z.number().int().min(1).optional(),
    minIdleHours: z.number().min(0).optional(),
    staleAfterDays: z.number().int().min(1).optional(),
    archiveAfterDays: z.number().int().min(1).optional(),
    consolidate: z.boolean().optional(),
    pruneBuiltins: z.boolean().optional(),
    archiveTtlDays: z.number().int().min(0).optional(),
    backup: z
      .object({
        enabled: z.boolean().optional(),
        keep: z.number().int().min(0).optional()
      })
      .optional(),
    ledger: z.boolean().optional()
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Provide at least one setting" });

export async function GET() {
  await requireUser();
  return ok({ config: getCuratorConfig() });
}

export async function PUT(request: Request) {
  await requireUser();
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return badRequest("Invalid skill maintenance settings");
  }

  return ok({ config: updateCuratorConfig(parsed.data) });
}
