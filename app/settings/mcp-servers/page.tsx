import { McpServersSection } from "@/components/settings/sections/mcp-servers-section";
import { requireUser } from "@/lib/auth";

export default async function McpServersPage() {
  await requireUser();
  return <McpServersSection />;
}
