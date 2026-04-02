import { AccountSection } from "@/components/settings/sections/account-section";
import { requireUser } from "@/lib/auth";

export default async function AccountPage() {
  const user = await requireUser();
  return <AccountSection user={user} />;
}
