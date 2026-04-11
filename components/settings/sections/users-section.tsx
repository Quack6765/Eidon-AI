"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Plus, Shield, Trash2, UserRound } from "lucide-react";

import { ProfileCard } from "@/components/settings/profile-card";
import { SettingsSplitPane } from "@/components/settings/settings-split-pane";
import { Badge } from "@/components/settings/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

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
    setError("");
    setSuccess("");
    loadDraft(user);
  }

  function handleAddUser() {
    setSelectedUserId(null);
    setIsAddingNew(true);
    setMobileDetailVisible(true);
    setDraftUsername("");
    setDraftPassword("");
    setDraftRole("user");
    setError("");
    setSuccess("");
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
      setError("Username is required.");
      return;
    }

    if (isAddingNew && draftPassword.length < 8) {
      setError("New users must have a password with at least 8 characters.");
      return;
    }

    if (!isAddingNew && selectedUser?.authSource === "env_super_admin") {
      return;
    }

    setIsSaving(true);
    setError("");
    setSuccess("");

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
        setError(readErrorMessage(payload, "Unable to save user"));
        return;
      }

      await refreshUsers(payload.user?.id ?? selectedUserId);
      setSuccess(isAddingNew ? "User created." : "User updated.");
      setMobileDetailVisible(true);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to save user");
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
    setError("");
    setSuccess("");

    try {
      const response = await fetch(`/api/users/${selectedUser.id}`, {
        method: "DELETE"
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(readErrorMessage(payload, "Unable to delete user"));
        return;
      }

      await refreshUsers(null);
      setSuccess("User deleted.");
      setMobileDetailVisible(false);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to delete user");
    } finally {
      setIsSaving(false);
    }
  }

  const showDetail = isAddingNew || Boolean(selectedUser);
  const isProtectedUser = selectedUser?.authSource === "env_super_admin";
  const emptyState = (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/6 bg-white/[0.03]">
        <UserRound className="h-5 w-5 text-[#52525b]" />
      </div>
      <p className="mt-4 text-[0.85rem] text-[#71717a]">
        Select a user from the roster or create a new login.
      </p>
    </div>
  );
  const selectClass =
    "w-full rounded-xl border border-white/6 bg-white/[0.03] px-4 py-3 text-sm outline-none transition-all duration-200 text-[#f4f4f5] focus:border-[rgba(139,92,246,0.3)]";

  return (
    <div className="min-h-0 p-4 md:h-full md:p-8">
      <SettingsSplitPane
        isDetailVisible={mobileDetailVisible}
        onBackAction={() => setMobileDetailVisible(false)}
        listHeader={
          <div className="flex w-full items-center justify-between">
            <div>
              <h2 className="text-[0.9rem] font-semibold text-[#f4f4f5]">Users</h2>
              <p className="text-[0.68rem] text-[#52525b]">
                {userRows.length} account{userRows.length === 1 ? "" : "s"}
              </p>
            </div>
            <button
              type="button"
              onClick={handleAddUser}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/6 bg-white/[0.03] text-[#71717a] transition-all duration-200 hover:bg-white/[0.06] hover:text-[#f4f4f5]"
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
            <div className="max-w-[620px] space-y-6">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/10 text-sky-300">
                      <Shield className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-300">
                        Access
                      </p>
                      <h3
                        className="text-[1.2rem] font-semibold text-[#f4f4f5]"
                        style={{ fontFamily: "var(--font-display)" }}
                      >
                        {isAddingNew ? "Create user" : selectedUser?.username}
                      </h3>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pl-12">
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
                  <Button
                    type="button"
                    variant="danger"
                    onClick={() => void deleteUser()}
                    disabled={isSaving}
                    className="gap-2"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete user
                  </Button>
                ) : null}
              </div>

              {isProtectedUser ? (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-amber-300/12 bg-amber-300/8 px-4 py-4 text-sm leading-6 text-amber-100/90">
                    This account is env-managed and protected from UI edits. Change the bootstrap
                    admin credentials through environment variables instead.
                  </div>
                  <div className="grid gap-4 rounded-2xl border border-white/6 bg-white/[0.02] p-5 md:grid-cols-2">
                    <div>
                      <Label>Username</Label>
                      <Input value={selectedUser?.username ?? ""} readOnly disabled />
                    </div>
                    <div>
                      <Label>Role</Label>
                      <Input value={selectedUser?.role ?? ""} readOnly disabled />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-5 rounded-2xl border border-white/6 bg-white/[0.02] p-5">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <Label>Username</Label>
                      <Input
                        value={draftUsername}
                        onChange={(event) => setDraftUsername(event.target.value)}
                        placeholder="Username"
                      />
                    </div>
                    <div>
                      <Label>Role</Label>
                      <select
                        value={draftRole}
                        onChange={(event) => setDraftRole(event.target.value as UserRole)}
                        className={selectClass}
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <Label>{isAddingNew ? "Password" : "New password"}</Label>
                    <Input
                      type="password"
                      value={draftPassword}
                      onChange={(event) => setDraftPassword(event.target.value)}
                      placeholder={isAddingNew ? "Set a password" : "Leave blank to keep the current password"}
                    />
                  </div>

                  <div className="rounded-2xl border border-white/6 bg-black/20 px-4 py-4 text-sm leading-6 text-[#a1a1aa]">
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

                  <div className="flex flex-wrap gap-2">
                    <Button type="button" onClick={() => void saveUser()} disabled={isSaving}>
                      {isAddingNew ? (
                        <>
                          <Plus className="mr-2 h-4 w-4" />
                          Create user
                        </>
                      ) : (
                        "Save changes"
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
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

              {success ? (
                <div className="rounded-2xl border border-emerald-400/12 bg-emerald-500/8 px-4 py-3 text-sm text-emerald-200">
                  {success}
                </div>
              ) : null}

              {error ? (
                <div className="rounded-2xl border border-red-400/12 bg-red-500/8 px-4 py-3 text-sm text-red-200">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    <span>{error}</span>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            emptyState
          )
        }
      />
    </div>
  );
}
