import { MemoriesSection } from "@/components/settings/sections/memories-section";
import { requireUser } from "@/lib/auth";

export default async function MemoriesPage() {
  await requireUser();

  return <MemoriesSection />;
}
