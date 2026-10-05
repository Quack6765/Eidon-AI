import { NotificationsSection } from "@/components/settings/sections/notifications-section";
import { requireUser } from "@/lib/auth";

export default async function NotificationsPage() {
  await requireUser();
  return <NotificationsSection />;
}
