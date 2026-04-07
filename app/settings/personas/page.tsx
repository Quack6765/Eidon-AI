import { PersonasSection } from "@/components/settings/sections/personas-section";
import { requireUser } from "@/lib/auth";

export default async function PersonasPage() {
  await requireUser();
  return <PersonasSection />;
}