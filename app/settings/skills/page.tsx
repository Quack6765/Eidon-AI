import { SkillsSection } from "@/components/settings/sections/skills-section";
import { requireUser } from "@/lib/auth";

export default async function SkillsPage() {
  await requireUser();
  return <SkillsSection />;
}
