import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { getCurrentUser } from "@/lib/auth";
import { isPasswordLoginEnabled } from "@/lib/env";

export default async function LoginPage() {
  if (!isPasswordLoginEnabled) {
    redirect("/");
  }

  const user = await getCurrentUser();

  if (user) {
    redirect("/");
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center px-6 py-10 overflow-hidden bg-[var(--background)]">
      <div
        className="absolute left-[15%] top-[20%] h-[400px] w-[400px] rounded-full opacity-20 blur-[120px]"
        style={{ background: "var(--accent)", animation: "float-orb 20s ease-in-out infinite" }}
      />
      <div
        className="absolute right-[10%] bottom-[15%] h-[350px] w-[350px] rounded-full opacity-15 blur-[120px]"
        style={{ background: "#6366f1", animation: "float-orb 25s ease-in-out infinite reverse" }}
      />
      <div
        className="absolute left-[50%] top-[60%] h-[300px] w-[300px] rounded-full opacity-10 blur-[100px]"
        style={{ background: "#a855f7", animation: "float-orb 18s ease-in-out infinite 5s" }}
      />
      <LoginForm />
    </main>
  );
}
