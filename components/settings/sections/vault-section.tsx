"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, KeyRound, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Toast } from "@/components/ui/toast";
import { UnsavedChangesDialog } from "@/components/ui/unsaved-changes-dialog";
import { useDirtyState } from "@/hooks/use-dirty-state";
import { useToastState } from "@/hooks/use-toast-state";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { MAX_SECRET_CHARS, MAX_VAULT_NOTES_CHARS, MAX_VAULT_USERNAME_CHARS } from "@/lib/constants";
import { fieldLabel, sectionTitle } from "@/lib/settings-styles";
import { formatRelativeTime } from "@/lib/utils";
import type { VaultEntry } from "@/lib/vault";

import { DetailActionBar } from "../detail-action-bar";
import { DetailHeader } from "../detail-header";
import { ProfileCard } from "../profile-card";
import { SettingsSplitPane } from "../settings-split-pane";

type Draft = { name: string; origin: string; username: string; notes: string };

const EMPTY_DRAFT: Draft = { name: "", origin: "", username: "", notes: "" };

function draftFrom(entry: VaultEntry): Draft {
  return { name: entry.name, origin: entry.origin ?? "", username: entry.username, notes: entry.notes };
}

function siteName(origin: string | null) {
  if (!origin) return "";
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

function entrySubtitle(entry: VaultEntry) {
  return [siteName(entry.origin) || "No site", entry.username].filter(Boolean).join(" · ");
}

function entrySummary(entry: VaultEntry) {
  return `Updated ${formatRelativeTime(entry.updatedAt)} · ${
    entry.lastUsedAt ? `last used ${formatRelativeTime(entry.lastUsedAt)}` : "not used yet"
  }`;
}

async function readError(response: Response, fallback: string) {
  const data = (await response.json().catch(() => null)) as { error?: string } | null;
  return data?.error ?? fallback;
}

export function VaultSection() {
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [mobileDetailVisible, setMobileDetailVisible] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [secret, setSecret] = useState("");
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<(() => void) | null>(null);
  const toast = useToastState();
  const entriesRequestVersion = useRef(0);
  const secretChanged = secret !== "" && secret !== (revealedSecret ?? "");
  const { isDirty, isFieldDirty, reset: resetDirty } = useDirtyState({ ...draft, secretChanged });
  useUnsavedChangesGuard({
    isDirty,
    save: saveEntry,
    discard: restoreDraft,
    entityType: "this secret"
  });

  useEffect(() => {
    const requestVersion = ++entriesRequestVersion.current;
    let active = true;

    void fetch("/api/vault")
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load the vault");
        return response.json() as Promise<{ vaultEntries?: VaultEntry[] }>;
      })
      .then((data) => {
        if (active && requestVersion === entriesRequestVersion.current && Array.isArray(data.vaultEntries)) {
          setEntries(data.vaultEntries);
        }
      })
      .catch(() => {});

    return () => {
      active = false;
      if (entriesRequestVersion.current === requestVersion) {
        entriesRequestVersion.current += 1;
      }
    };
  }, []);

  const selectedEntry = entries.find((entry) => entry.id === selectedId) ?? null;
  const showDetail = Boolean(selectedEntry) || isAddingNew;

  function loadDraft(next: Draft) {
    setDraft(next);
    setSecret("");
    setRevealedSecret(null);
    setShowSecret(false);
    resetDirty({ ...next, secretChanged: false });
  }

  function restoreDraft() {
    if (selectedEntry) {
      setDraft(draftFrom(selectedEntry));
      setSecret(revealedSecret ?? "");
      resetDirty({ ...draftFrom(selectedEntry), secretChanged: false });
      return;
    }
    loadDraft(EMPTY_DRAFT);
  }

  function selectEntry(entry: VaultEntry) {
    setSelectedId(entry.id);
    setIsAddingNew(false);
    setMobileDetailVisible(true);
    loadDraft(draftFrom(entry));
  }

  function addNewEntry() {
    setSelectedId(null);
    setIsAddingNew(true);
    setMobileDetailVisible(true);
    loadDraft(EMPTY_DRAFT);
  }

  function guardSwitch(action: () => void) {
    if (isDirty) {
      setPendingSwitch(() => action);
      setUnsavedDialogOpen(true);
      return;
    }
    action();
  }

  async function toggleSecret() {
    if (showSecret) {
      setShowSecret(false);
      return;
    }
    if (selectedEntry && revealedSecret === null && !secret) {
      setRevealing(true);
      try {
        const response = await fetch(`/api/vault/${encodeURIComponent(selectedEntry.id)}/secret`, { cache: "no-store" });
        if (!response.ok) {
          toast.showToast("error", await readError(response, "Couldn't show the secret."));
          return;
        }
        const data = (await response.json()) as { secret: string };
        setRevealedSecret(data.secret);
        setSecret(data.secret);
      } catch {
        toast.showToast("error", "Couldn't show the secret.");
        return;
      } finally {
        setRevealing(false);
      }
    }
    setShowSecret(true);
  }

  async function saveEntry(): Promise<boolean> {
    if (!draft.name.trim()) {
      toast.showToast("error", "Give the secret a name.");
      return false;
    }
    if (!selectedEntry && !secret) {
      toast.showToast("error", "Enter the secret's value.");
      return false;
    }

    const body = {
      name: draft.name,
      origin: draft.origin.trim() || null,
      username: draft.username,
      notes: draft.notes,
      ...(secretChanged || !selectedEntry ? { secret } : {})
    };
    setSaving(true);
    try {
      const response = await fetch(selectedEntry ? `/api/vault/${encodeURIComponent(selectedEntry.id)}` : "/api/vault", {
        method: selectedEntry ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        toast.showToast("error", await readError(response, "Couldn't save the secret."));
        return false;
      }
      const { vaultEntry } = (await response.json()) as { vaultEntry: VaultEntry };
      entriesRequestVersion.current += 1;
      setEntries((current) =>
        [...current.filter((entry) => entry.id !== vaultEntry.id), vaultEntry].sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
        )
      );
      selectEntry(vaultEntry);
      toast.showToast("success", "Secret saved.");
      return true;
    } catch {
      toast.showToast("error", "Couldn't save the secret.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntry() {
    const entry = selectedEntry;
    setDeleteConfirmOpen(false);
    if (!entry) return;
    try {
      const response = await fetch(`/api/vault/${encodeURIComponent(entry.id)}`, { method: "DELETE" });
      if (!response.ok) {
        toast.showToast("error", "Couldn't delete the secret.");
        return;
      }
      entriesRequestVersion.current += 1;
      setEntries((current) => current.filter((item) => item.id !== entry.id));
      setSelectedId(null);
      setMobileDetailVisible(false);
      loadDraft(EMPTY_DRAFT);
      toast.showToast("success", "Secret deleted.");
    } catch {
      toast.showToast("error", "Couldn't delete the secret.");
    }
  }

  async function handleUnsavedSave() {
    if (!(await saveEntry())) return;
    setUnsavedDialogOpen(false);
    pendingSwitch?.();
    setPendingSwitch(null);
  }

  function handleUnsavedDiscard() {
    setUnsavedDialogOpen(false);
    restoreDraft();
    pendingSwitch?.();
    setPendingSwitch(null);
  }

  const title = isAddingNew ? "New secret" : selectedEntry?.name ?? "Secret";
  const dirtyClass = (field: keyof Draft | "secretChanged") => (isFieldDirty(field) ? "border-amber-500/40" : "");

  return (
    <div className="flex min-h-0 w-full flex-1">
      <SettingsSplitPane
        backLabel="Vault"
        detailTitle={title}
        listHeader={
          <div className="flex w-full items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text)]">Vault</h2>
              <p className="text-xs text-[var(--muted)]">
                {entries.length} secret{entries.length !== 1 ? "s" : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => guardSwitch(addNewEntry)}
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-[var(--muted)] transition-colors duration-200 hover:bg-white/[0.07] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/45 md:h-9 md:w-9"
              aria-label="Add secret"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        }
        listPanel={
          entries.length === 0 ? (
            <div className="flex flex-col items-center px-4 py-12 text-center">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-white/6 bg-white/[0.03]">
                <KeyRound className="h-4 w-4 text-[var(--muted)]" />
              </div>
              <p className="text-xs leading-5 text-[var(--muted)]">
                Nothing in your vault yet. Add a password or API key here, or give one to Eidon in a chat and ask it to save it.
              </p>
            </div>
          ) : (
            entries.map((entry) => (
              <ProfileCard
                key={entry.id}
                isActive={entry.id === selectedId}
                onClick={() => {
                  if (entry.id !== selectedId) guardSwitch(() => selectEntry(entry));
                }}
                title={entry.name}
                subtitle={entrySubtitle(entry)}
              />
            ))
          )
        }
        isDetailVisible={mobileDetailVisible}
        onBackAction={() => setMobileDetailVisible(false)}
        detailPanel={
          <div className="w-full max-w-[720px]">
            {showDetail ? (
              <div className="space-y-0">
                <DetailHeader
                  title={title}
                  summary={
                    selectedEntry
                      ? entrySummary(selectedEntry)
                      : "Store a password, API key or token. Eidon can use it without ever seeing the value."
                  }
                />

                <div className="py-5">
                  <h4 className={sectionTitle}>Secret</h4>
                  <div className="mt-4 space-y-5">
                    <div>
                      <label htmlFor="vault-name" className={fieldLabel}>Name</label>
                      <Input
                        id="vault-name"
                        value={draft.name}
                        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                        placeholder="Email password"
                        autoComplete="off"
                        className={dirtyClass("name")}
                      />
                      <p className="mt-1.5 text-xs leading-5 text-[var(--muted)]">Eidon refers to the secret by this name.</p>
                    </div>
                    <div>
                      <label htmlFor="vault-secret" className={fieldLabel}>Value</label>
                      <div className="relative">
                        <Input
                          id="vault-secret"
                          type={showSecret ? "text" : "password"}
                          value={secret}
                          onChange={(event) => setSecret(event.target.value)}
                          placeholder={selectedEntry ? "Stored. Leave empty to keep it" : "Required"}
                          autoComplete="new-password"
                          spellCheck={false}
                          maxLength={MAX_SECRET_CHARS}
                          className={`pr-10 ${dirtyClass("secretChanged")}`}
                        />
                        <button
                          type="button"
                          aria-label={showSecret ? "Hide value" : "Show value"}
                          disabled={revealing}
                          onClick={() => void toggleSecret()}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] transition-colors hover:text-[var(--text)] disabled:opacity-50"
                        >
                          {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="py-5">
                  <h4 className={sectionTitle}>Where it&apos;s used</h4>
                  <div className="mt-4 space-y-5">
                    <div>
                      <label htmlFor="vault-origin" className={fieldLabel}>Website</label>
                      <Input
                        id="vault-origin"
                        value={draft.origin}
                        onChange={(event) => setDraft({ ...draft, origin: event.target.value })}
                        placeholder="https://example.com"
                        inputMode="url"
                        autoComplete="off"
                        spellCheck={false}
                        className={dirtyClass("origin")}
                      />
                      <p className="mt-1.5 text-xs leading-5 text-[var(--muted)]">
                        Eidon only types this secret into pages on this site. Leave it empty for API keys and tokens.
                      </p>
                    </div>
                    <div>
                      <label htmlFor="vault-username" className={fieldLabel}>Username</label>
                      <Input
                        id="vault-username"
                        value={draft.username}
                        onChange={(event) => setDraft({ ...draft, username: event.target.value })}
                        placeholder="Optional"
                        autoComplete="off"
                        spellCheck={false}
                        maxLength={MAX_VAULT_USERNAME_CHARS}
                        className={dirtyClass("username")}
                      />
                    </div>
                    <div>
                      <label htmlFor="vault-notes" className={fieldLabel}>Notes</label>
                      <Textarea
                        id="vault-notes"
                        value={draft.notes}
                        onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                        placeholder="What it's for, which account, anything else worth knowing"
                        rows={3}
                        maxLength={MAX_VAULT_NOTES_CHARS}
                        className={dirtyClass("notes")}
                      />
                      <p className="mt-1.5 text-xs leading-5 text-[var(--muted)]">
                        Eidon can read your notes, so never put a secret value here.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/6 bg-white/[0.03]">
                  <KeyRound className="h-5 w-5 text-[var(--muted)]" />
                </div>
                <p className="text-sm text-[var(--muted)]">Select a secret or add a new one</p>
              </div>
            )}
          </div>
        }
        detailFooter={
          showDetail ? (
            <DetailActionBar
              status={isDirty ? "unsaved" : "saved"}
              leftActions={
                selectedEntry ? (
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmOpen(true)}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm text-red-400/80 transition-colors hover:bg-red-500/[0.06] hover:text-red-300 md:min-h-10"
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
                    onClick={restoreDraft}
                  >
                    Discard
                  </Button>
                  <Button
                    type="button"
                    size="lg"
                    className="min-h-11 px-5 text-sm md:min-h-10"
                    disabled={saving}
                    onClick={() => void saveEntry()}
                  >
                    Save
                  </Button>
                </>
              }
            />
          ) : null
        }
      />
      <Toast visible={toast.visible} variant={toast.variant} message={toast.message} />
      <UnsavedChangesDialog
        open={unsavedDialogOpen}
        onOpenChange={setUnsavedDialogOpen}
        entityType="this secret"
        onSave={handleUnsavedSave}
        onDiscard={handleUnsavedDiscard}
      />
      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Delete secret?"
        description={
          <>
            <strong className="font-medium text-[var(--text)]">{selectedEntry?.name ?? "This secret"}</strong> will be
            permanently deleted. Eidon will have to ask you for it again.
          </>
        }
        onConfirm={() => void deleteEntry()}
      />
    </div>
  );
}
