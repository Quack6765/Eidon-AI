"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2, UserRound } from "lucide-react";

import { ProfileCard } from "@/components/settings/profile-card";
import { SettingsSplitPane } from "@/components/settings/settings-split-pane";
import { Badge } from "@/components/settings/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Toast } from "@/components/ui/toast";
import { useToastState } from "@/hooks/use-toast-state";
import type { PersistedUser, UserRole } from "@/lib/types";

function readErrorMessage(payload: unknown, fallback: string) {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }

  return fallback;
}

function buildRoleBadge(user: PersistedUser) {
  return user.role === "admin"
    ? { variant: "violet" as const, label: "Admin" }
    : { variant: "default" as const, label: "User" };
}

function buildAuthBadge(user: PersistedUser) {
  return user.authSource === "env_super_admin"
    ? { variant: "builtin" as const, label: "Env-managed" }
    : { variant: "http" as const, label: "Local" };
}

export function UsersSection({ users }: { users: PersistedUser[] }) {
  const [userRows, setUserRows] = useState(users);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(users[0]?.id ?? null);
  const [mobileDetailVisible, setMobileDetailVisible] = useState(Boolean(users[0]));
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [draftUsername, setDraftUsername] = useState(users[0]?.username ?? "");
  const [draftPassword, setDraftPassword] = useState("");
  const [draftRole, setDraftRole] = useState<UserRole>(users[0]?.role ?? "user");
  const [isSaving, setIsSaving] = useState(false);
  const toast = useToastState();

  const selectedUser = useMemo(
    () => userRows.find((user) => user.id === selectedUserId) ?? null,
    [selectedUserId, userRows]
  );

  function loadDraft(user: PersistedUser | null) {
    setDraftUsername(user?.username ?? "");
    setDraftPassword("");
    setDraftRole(user?.role ?? "user");
  }

  function handleSelectUser(user: PersistedUser) {
    setSelectedUserId(user.id);
    setIsAddingNew(false);
    setMobileDetailVisible(true);
    toast.dismissToast();
    loadDraft(user);
  }

  function handleAddUser() {
    setSelectedUserId(null);
    setIsAddingNew(true);
    setMobileDetailVisible(true);
    setDraftUsername("");
    setDraftPassword("");
    setDraftRole("user");
    toast.dismissToast();
  }

  async function refreshUsers(nextSelectedUserId?: string | null) {
    const response = await fetch("/api/users");
    const payload = (await response.json()) as { users?: PersistedUser[]; error?: string };

    if (!response.ok || !payload.users) {
      throw new Error(readErrorMessage(payload, "Unable to refresh users"));
    }

    setUserRows(payload.users);

    const fallbackUser = nextSelectedUserId
      ? payload.users.find((user) => user.id === nextSelectedUserId) ?? payload.users[0] ?? null
      : payload.users[0] ?? null;

    setSelectedUserId(fallbackUser?.id ?? null);
    setIsAddingNew(false);
    loadDraft(fallbackUser);
  }

  async function saveUser() {
    if (!draftUsername.trim()) {
      toast.showToast("error", "Username is required.");
      return;
    }

    if (isAddingNew && draftPassword.length < 8) {
      toast.showToast("error", "New users must have a password with at least 8 characters.");
      return;
    }

    if (!isAddingNew && selectedUser?.authSource === "env_super_admin") {
      return;
    }

    setIsSaving(true);
    toast.dismissToast();

    try {
      const response = await fetch(
        isAddingNew ? "/api/users" : `/api/users/${selectedUserId}`,
        {
          method: isAddingNew ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: draftUsername,
            password: draftPassword,
            role: draftRole
          })
        }
      );
      const payload = (await response.json()) as { user?: PersistedUser; error?: string };

      if (!response.ok) {
        toast.showToast("error", readErrorMessage(payload, "Unable to save user"));
        return;
      }

      await refreshUsers(payload.user?.id ?? selectedUserId);
      toast.showToast("success", isAddingNew ? "User created." : "User updated.");
      setMobileDetailVisible(true);
    } catch (caughtError) {
      toast.showToast("error", caughtError instanceof Error ? caughtError.message : "Unable to save user");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteUser() {
    if (!selectedUser || selectedUser.authSource === "env_super_admin") {
      return;
    }

    if (!window.confirm(`Delete ${selectedUser.username}?`)) {
      return;
    }

    setIsSaving(true);
    toast.dismissToast();

    try {
      const response = await fetch(`/api/users/${selectedUser.id}`, {
        method: "DELETE"
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        toast.showToast("error", readErrorMessage(payload, "Unable to delete user"));
        return;
      }

      await refreshUsers(null);
      toast.showToast("success", "User deleted.");
      setMobileDetailVisible(false);
    } catch (caughtError) {
      toast.showToast("error", caughtError instanceof Error ? caughtError.message : "Unable to delete user");
    } finally {
      setIsSaving(false);
    }
  }

  const showDetail = isAddingNew || Boolean(selectedUser);
  const isProtectedUser = selectedUser?.authSource === "env_super_admin";

  const fieldLabel = "block text-[13px] font-medium text-[var(--muted)] mb-1.5";
  const inputLike = "w-full rounded-xl border border-white/6 bg-white/4 px-4 py-3 text-sm text-[var(--text)] outline-none transition-all duration-200 focus:border-[var(--accent)]/40 focus:bg-white/6 focus:shadow-[0_0_0_3px_var(--accent-soft)]";
  const selectLike = `${inputLike} appearance-none bg-[url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2371717a%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-[length:1rem_1rem] bg-[right_0.75rem_center] bg-no-repeat pr-10`;
  const sectionTitle = "text-sm font-semibold text-[var(--text)]";
  const sectionDivider = "border-t border-white/[0.06]";

  const emptyState = (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/6 bg-white/[0.03]">
        <UserRound className="h-5 w-5 text-[var(--muted)]" />
      </div>
      <p className="mt-4 text-[0.85rem] text-[var(--muted)]">
        Select a user from the roster or create a new login.
      </p>
    </div>
  );

  return (
    <div className="min-h-0 p-4 md:h-full md:p-8">
      <SettingsSplitPane
        isDetailVisible={mobileDetailVisible}
        onBackAction={() => setMobileDetailVisible(false)}
        listHeader={
          <div className="flex w-full items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text)]">Users</h2>
              <p className="text-xs text-[var(--muted)]">
                {userRows.length} account{userRows.length === 1 ? "" : "s"}
              </p>
            </div>
            <button
              type="button"
              onClick={handleAddUser}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/6 bg-white/[0.03] text-[var(--muted)] transition-all duration-200 hover:bg-white/[0.06] hover:text-[var(--text)]"
              aria-label="Add user"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        }
        listPanel={
          <>
            {userRows.map((user) => (
              <ProfileCard
                key={user.id}
                isActive={selectedUserId === user.id && !isAddingNew}
                onClick={() => handleSelectUser(user)}
                title={user.username}
                subtitle={user.authSource === "env_super_admin" ? "Protected bootstrap admin" : "Private workspace"}
                badges={[buildRoleBadge(user), buildAuthBadge(user)]}
              />
            ))}
          </>
        }
        detailPanel={
          showDetail ? (
            <div className="max-w-[720px] space-y-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className={sectionTitle}>
                    {isAddingNew ? "Create user" : selectedUser?.username}
                  </h3>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {selectedUser ? (
                      <>
                        <Badge variant={buildRoleBadge(selectedUser).variant}>
                          {buildRoleBadge(selectedUser).label}
                        </Badge>
                        <Badge variant={buildAuthBadge(selectedUser).variant}>
                          {buildAuthBadge(selectedUser).label}
                        </Badge>
                      </>
                    ) : (
                      <Badge variant="default">New account</Badge>
                    )}
                  </div>
                </div>

                {!isAddingNew && !isProtectedUser ? (
                  <button
                    type="button"
                    onClick={() => void deleteUser()}
                    disabled={isSaving}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-red-400/80 transition-colors hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                ) : null}
              </div>

              <div className={sectionDivider} />

              {isProtectedUser ? (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-amber-300/12 bg-amber-300/8 px-4 py-4 text-sm leading-6 text-amber-100/90">
                    This account is env-managed and protected from UI edits. Change the bootstrap
                    admin credentials through environment variables instead.
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className={fieldLabel}>Username</label>
                      <Input value={selectedUser?.username ?? ""} readOnly disabled className={inputLike} />
                    </div>
                    <div>
                      <label className={fieldLabel}>Role</label>
                      <Input value={selectedUser?.role ?? ""} readOnly disabled className={inputLike} />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className={fieldLabel}>Username</label>
                      <Input
                        value={draftUsername}
                        onChange={(event) => setDraftUsername(event.target.value)}
                        placeholder="Username"
                        className={inputLike}
                      />
                    </div>
                    <div>
                      <label className={fieldLabel}>Role</label>
                      <select
                        value={draftRole}
                        onChange={(event) => setDraftRole(event.target.value as UserRole)}
                        className={selectLike}
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className={fieldLabel}>{isAddingNew ? "Password" : "New password"}</label>
                    <Input
                      type="password"
                      value={draftPassword}
                      onChange={(event) => setDraftPassword(event.target.value)}
                      placeholder={isAddingNew ? "Set a password" : "Leave blank to keep the current password"}
                      className={inputLike}
                    />
                  </div>

                  <div className="rounded-2xl border border-white/6 bg-black/20 px-4 py-4 text-sm leading-6 text-[var(--muted)]">
                    {isAddingNew ? (
                      <>
                        New users start with their own empty conversations, personas, memories,
                        and automations.
                      </>
                    ) : (
                      <>
                        This login has a private workspace. Updating the role changes access to
                        server-wide settings but does not expose anyone else&apos;s data.
                      </>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" className="px-3 py-1.5 text-xs" onClick={() => void saveUser()} disabled={isSaving}>
                      Save
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="px-2.5 py-1.5 text-xs"
                      onClick={() => {
                        if (selectedUser) {
                          handleSelectUser(selectedUser);
                          return;
                        }
                        setIsAddingNew(false);
                        setMobileDetailVisible(false);
                      }}
                      disabled={isSaving}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              <div className={sectionDivider} />

              <Toast
                visible={toast.visible}
                variant={toast.variant}
                message={toast.message}
              />
            </div>
          ) : (
            emptyState
          )
        }
      />
    </div>
  );
}
