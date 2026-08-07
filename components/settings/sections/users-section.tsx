"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2, UserRound } from "lucide-react";

import { ProfileCard } from "@/components/settings/profile-card";
import { SettingsSplitPane } from "@/components/settings/settings-split-pane";
import { Badge } from "@/components/settings/badge";
import { DetailActionBar } from "@/components/settings/detail-action-bar";
import { DetailHeader } from "@/components/settings/detail-header";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Toast } from "@/components/ui/toast";
import { UnsavedChangesDialog } from "@/components/ui/unsaved-changes-dialog";
import { fieldLabel, inputLike, selectLike } from "@/lib/settings-styles";
import { useToastState } from "@/hooks/use-toast-state";
import { useDirtyState } from "@/hooks/use-dirty-state";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
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
  const [mobileDetailVisible, setMobileDetailVisible] = useState(false);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [draftUsername, setDraftUsername] = useState(users[0]?.username ?? "");
  const [draftPassword, setDraftPassword] = useState("");
  const [draftRole, setDraftRole] = useState<UserRole>(users[0]?.role ?? "user");
  const [isSaving, setIsSaving] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<(() => void) | null>(null);
  const toast = useToastState();

  const { isDirty, isFieldDirty, reset: resetDirty } = useDirtyState({
    draftUsername,
    draftPassword,
    draftRole,
  });
  useUnsavedChangesGuard({
    isDirty,
    save: saveUser,
    discard: restoreUserDraft,
    entityType: "this user"
  });

  const selectedUser = useMemo(
    () => userRows.find((user) => user.id === selectedUserId) ?? null,
    [selectedUserId, userRows]
  );

  function loadDraft(user: PersistedUser | null) {
    const draft = {
      draftUsername: user?.username ?? "",
      draftPassword: "",
      draftRole: user?.role ?? ("user" as UserRole),
    };
    setDraftUsername(draft.draftUsername);
    setDraftPassword("");
    setDraftRole(draft.draftRole);
    resetDirty(draft);
  }

  function restoreUserDraft() {
    const saved = userRows.find((user) => user.id === selectedUserId) ?? null;
    loadDraft(saved);
  }

  function selectUser(user: PersistedUser) {
    setSelectedUserId(user.id);
    setIsAddingNew(false);
    setMobileDetailVisible(true);
    toast.dismissToast();
    loadDraft(user);
  }

  function handleSelectUser(user: PersistedUser) {
    if (isDirty && selectedUserId !== user.id) {
      setPendingSwitch(() => () => selectUser(user));
      setUnsavedDialogOpen(true);
      return;
    }
    selectUser(user);
  }

  function addUser() {
    setSelectedUserId(null);
    setIsAddingNew(true);
    setMobileDetailVisible(true);
    const draft = { draftUsername: "", draftPassword: "", draftRole: "user" as UserRole };
    setDraftUsername("");
    setDraftPassword("");
    setDraftRole("user");
    toast.dismissToast();
    resetDirty(draft);
  }

  function handleAddUser() {
    if (isDirty) {
      setPendingSwitch(() => () => addUser());
      setUnsavedDialogOpen(true);
      return;
    }
    addUser();
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

  async function saveUser(): Promise<boolean> {
    if (!draftUsername.trim()) {
      toast.showToast("error", "Username is required.");
      return false;
    }

    if (isAddingNew && draftPassword.length < 8) {
      toast.showToast("error", "New users must have a password with at least 8 characters.");
      return false;
    }

    if (!isAddingNew && selectedUser?.authSource === "env_super_admin") {
      return false;
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
        return false;
      }

      await refreshUsers(payload.user?.id ?? selectedUserId);
      toast.showToast("success", isAddingNew ? "User created." : "User updated.");
      setMobileDetailVisible(true);
      return true;
    } catch (caughtError) {
      toast.showToast("error", caughtError instanceof Error ? caughtError.message : "Unable to save user");
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteUser() {
    if (!selectedUser || selectedUser.authSource === "env_super_admin") {
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

  function handleDeleteConfirm() {
    void deleteUser();
    setDeleteConfirmOpen(false);
    setPendingDeleteId(null);
  }

  async function handleUnsavedSave() {
    if (!(await saveUser())) return;
    setUnsavedDialogOpen(false);
    pendingSwitch?.();
    setPendingSwitch(null);
  }

  function handleUnsavedDiscard() {
    setUnsavedDialogOpen(false);
    restoreUserDraft();
    if (pendingSwitch) {
      pendingSwitch();
      setPendingSwitch(null);
    }
  }

  const showDetail = isAddingNew || Boolean(selectedUser);
  const isProtectedUser = selectedUser?.authSource === "env_super_admin";


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
    <div className="flex min-h-0 w-full flex-1">
      <SettingsSplitPane
        backLabel="Users"
        detailTitle={isAddingNew ? "New user" : selectedUser?.username ?? "User"}
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
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.03] text-[var(--muted)] transition-colors duration-200 hover:bg-white/[0.06] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/45 md:h-9 md:w-9"
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
              <DetailHeader
                title={isAddingNew ? "Create user" : selectedUser?.username ?? "User"}
                summary={
                  isAddingNew
                    ? "Create a new login with its own private workspace."
                    : "Manage this login's credentials, role, and access."
                }
                badge={
                  selectedUser ? (
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
                  )
                }
              />

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
                        className={`${inputLike} ${isFieldDirty("draftUsername") ? "!border-amber-500/40" : ""}`}
                      />
                    </div>
                    <div>
                      <label className={fieldLabel}>Role</label>
                      <select
                        value={draftRole}
                        onChange={(event) => setDraftRole(event.target.value as UserRole)}
                        className={`${selectLike} ${isFieldDirty("draftRole") ? "!border-amber-500/40" : ""}`}
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
                      className={`${inputLike} ${isFieldDirty("draftPassword") ? "!border-amber-500/40" : ""}`}
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
                </div>
              )}

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
        detailFooter={
          showDetail && !isProtectedUser ? (
            <DetailActionBar
              status={isDirty ? "unsaved" : "saved"}
              leftActions={
                !isAddingNew && selectedUser ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPendingDeleteId(selectedUser.id);
                      setDeleteConfirmOpen(true);
                    }}
                    disabled={isSaving}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm text-red-400/80 transition-colors hover:bg-red-500/[0.06] hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50 md:min-h-10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                ) : null
              }
              rightActions={
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="lg"
                    className="min-h-11 px-4 text-sm md:min-h-10"
                    onClick={restoreUserDraft}
                    disabled={isSaving}
                  >
                    Discard
                  </Button>
                  <Button
                    type="button"
                    size="lg"
                    className="min-h-11 px-5 text-sm md:min-h-10"
                    onClick={() => void saveUser()}
                    disabled={isSaving}
                  >
                    Save
                  </Button>
                </>
              }
            />
          ) : null
        }
      />
      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Delete user?"
        description={
          <>
            <strong className="text-[var(--text)] font-medium">{selectedUser?.username || "This user"}</strong> will be permanently deleted. This action cannot be undone.
          </>
        }
        onConfirm={handleDeleteConfirm}
      />
      <UnsavedChangesDialog
        open={unsavedDialogOpen}
        onOpenChange={setUnsavedDialogOpen}
        entityType="this user"
        onSave={handleUnsavedSave}
        onDiscard={handleUnsavedDiscard}
      />
    </div>
  );
}
