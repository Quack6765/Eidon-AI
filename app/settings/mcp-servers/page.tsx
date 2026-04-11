import { notFound } from "next/navigation";

import { McpServersSection } from "@/components/settings/sections/mcp-servers-section";
import { requireAdminUser } from "@/lib/auth";

export default async function McpServersPage() {
  try {
    await requireAdminUser();
  } catch (error) {
    if (error instanceof Error && error.message === "forbidden") {
      notFound();
    }
    throw error;
  }

  return <McpServersSection />;
}
