import { notFound } from "next/navigation";

import { requireAdminUser } from "@/lib/auth";
import { isPasswordLoginEnabled } from "@/lib/env";
import { listUsers } from "@/lib/users";

export default async function UsersPage() {
  if (!isPasswordLoginEnabled()) {
    notFound();
  }

  try {
    await requireAdminUser();
  } catch (error) {
    if (error instanceof Error && error.message === "forbidden") {
      notFound();
    }
    throw error;
  }

  const users = listUsers();

  return (
    <section className="mx-auto max-w-5xl px-6 py-8 md:px-8">
      <div className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.015))] p-8 shadow-[0_24px_80px_rgba(0,0,0,0.24)]">
        <div className="max-w-2xl space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-amber-300/80">
            Users
          </p>
          <h1
            className="text-3xl text-[var(--text)] md:text-4xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Managed access is enabled.
          </h1>
          <p className="text-sm leading-6 text-[var(--muted)] md:text-base">
            Password login is active, so this server now keeps separate workspaces per person.
            The full create, edit, and delete controls land in the next UI pass. For now, this
            page confirms the protected route and the persisted user roster.
          </p>
        </div>

        <div className="mt-8 grid gap-3">
          {users.map((user) => (
            <div
              key={user.id}
              className="flex flex-col gap-3 rounded-2xl border border-white/8 bg-black/20 px-4 py-4 md:flex-row md:items-center md:justify-between"
            >
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-[var(--text)]">{user.username}</p>
                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                    {user.role}
                  </span>
                  <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-amber-200">
                    {user.authSource === "env_super_admin" ? "env auth" : "local auth"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Created {new Date(user.createdAt).toLocaleString()}
                </p>
              </div>
              <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
                Private workspace
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
