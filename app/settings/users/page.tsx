import { notFound } from "next/navigation";

import { UsersSection } from "@/components/settings/sections/users-section";
import { requireAdminUser } from "@/lib/auth";
import { isPasswordLoginEnabled } from "@/lib/env";
import { listUsers } from "@/lib/users";

export default async function UsersPage() {
  if (!isPasswordLoginEnabled()) {
    notFound();
  }

  try {
    await requireAdminUser();
  } catch (error) {
    if (error instanceof Error && error.message === "forbidden") {
      notFound();
    }
    throw error;
  }

  return <UsersSection users={listUsers()} />;
}
