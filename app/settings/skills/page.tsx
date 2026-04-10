import { notFound } from "next/navigation";

import { SkillsSection } from "@/components/settings/sections/skills-section";
import { requireAdminUser } from "@/lib/auth";

export default async function SkillsPage() {
  try {
    await requireAdminUser();
  } catch (error) {
    if (error instanceof Error && error.message === "forbidden") {
      notFound();
    }
    throw error;
  }

  return <SkillsSection />;
}
