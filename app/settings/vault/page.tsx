import { VaultSection } from "@/components/settings/sections/vault-section";
import { requireUser } from "@/lib/auth";

export default async function VaultPage() {
  await requireUser();
  return <VaultSection />;
}
