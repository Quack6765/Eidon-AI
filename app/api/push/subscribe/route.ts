import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";
import {
  deletePushSubscription,
  listPushSubscriptions,
  savePushSubscription
} from "@/lib/push-notifications";

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1)
  })
});

const unsubscribeSchema = z.object({
  endpoint: z.string().min(1)
});

export async function GET() {
  const user = await requireUser();
  return ok({ subscriptions: listPushSubscriptions(user.id) });
}

export async function POST(request: Request) {
  const user = await requireUser();
  const body = subscribeSchema.safeParse(await request.json());

  if (!body.success) {
    return badRequest("Invalid push subscription");
  }

  try {
    const subscription = savePushSubscription(user.id, body.data);
    return ok({ subscription }, { status: 201 });
  } catch {
    return badRequest("Invalid push subscription");
  }
}

export async function DELETE(request: Request) {
  const user = await requireUser();
  const body = unsubscribeSchema.safeParse(await request.json().catch(() => null));

  if (!body.success) {
    return badRequest("Invalid push subscription");
  }

  const deleted = deletePushSubscription(user.id, body.data.endpoint);
  if (!deleted) {
    return badRequest("Push subscription not found", 404);
  }

  return ok({ success: true });
}
