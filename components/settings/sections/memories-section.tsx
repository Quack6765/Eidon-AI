"use client";

import { useEffect, useState, useCallback } from "react";
import { Brain, Search, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SettingsAccordion } from "@/components/settings/settings-accordion";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Toast } from "@/components/ui/toast";
import { fieldLabel, inputLike, selectLike } from "@/lib/settings-styles";
import { useToastState } from "@/hooks/use-toast-state";
import type { AppSettings, MemoryCategory, UserMemory } from "@/lib/types";

import { SettingsSplitPane } from "../settings-split-pane";
import { ProfileCard } from "../profile-card";
import { DetailHeader } from "../detail-header";

const CATEGORIES: Array<{ value: MemoryCategory | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "personal", label: "Personal" },
  { value: "preference", label: "Preference" },
  { value: "work", label: "Work" },
  { value: "location", label: "Location" },
  { value: "other", label: "Other" }
];

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 30) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

export function MemoriesSection() {
  const [memories, setMemories] = useState<UserMemory[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [filterCategory, setFilterCategory] = useState<MemoryCategory | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editCategory, setEditCategory] = useState<MemoryCategory>("other");
  const [mobileDetailVisible, setMobileDetailVisible] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const toast = useToastState();

  const fetchMemories = useCallback(async (params?: string) => {
    const url = params ? `/api/memories?${params}` : "/api/memories";
    const res = await fetch(url);
    const data = (await res.json()) as { memories: UserMemory[] };
    setMemories(data.memories);
  }, []);

  const fetchSettings = useCallback(async () => {
    const res = await fetch("/api/settings");
    const data = (await res.json()) as { settings: AppSettings };
    setSettings(data.settings);
  }, []);

  useEffect(() => {
    fetchMemories();
    fetchSettings();
  }, [fetchMemories, fetchSettings]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (filterCategory !== "all") params.set("category", filterCategory);
    if (searchQuery.trim()) params.set("search", searchQuery.trim());
    fetchMemories(params.toString() || undefined);
  }, [filterCategory, searchQuery, fetchMemories]);

  async function saveSettings(patch: Partial<AppSettings>) {
    try {
      const res = await fetch("/api/settings/general", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...settings, ...patch })
      });
      if (!res.ok) {
        toast.showToast("error", "Failed to save settings.");
        return;
      }
      const data = (await res.json()) as { settings: AppSettings };
      setSettings(data.settings);
      toast.showToast("success", "Settings saved.");
    } catch {
      toast.showToast("error", "Failed to save settings.");
    }
  }

  async function saveMemory() {
    if (!selectedMemoryId || !editContent.trim()) return;

    try {
      const res = await fetch(`/api/memories/${selectedMemoryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: editContent.trim(),
          category: editCategory
        })
      });
      if (!res.ok) {
        toast.showToast("error", "Failed to save memory.");
        return;
      }

      const params = new URLSearchParams();
      if (filterCategory !== "all") params.set("category", filterCategory);
      if (searchQuery.trim()) params.set("search", searchQuery.trim());
      await fetchMemories(params.toString() || undefined);
      setSelectedMemoryId(null);
      setMobileDetailVisible(false);
      toast.showToast("success", "Memory saved.");
    } catch {
      toast.showToast("error", "Failed to save memory.");
    }
  }

  async function deleteMemory(id: string) {
    try {
      const res = await fetch(`/api/memories/${id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.showToast("error", "Failed to delete memory.");
        return;
      }
      setMemories((prev) => prev.filter((m) => m.id !== id));
      if (selectedMemoryId === id) {
        setSelectedMemoryId(null);
        setMobileDetailVisible(false);
      }
      toast.showToast("success", "Memory deleted.");
    } catch {
      toast.showToast("error", "Failed to delete memory.");
    }
  }

  function handleDeleteConfirm() {
    if (pendingDeleteId) {
      deleteMemory(pendingDeleteId);
    }
    setDeleteConfirmOpen(false);
    setPendingDeleteId(null);
  }

  function handleSelectMemory(memory: UserMemory) {
    setSelectedMemoryId(memory.id);
    setEditContent(memory.content);
    setEditCategory(memory.category);
    setMobileDetailVisible(true);
  }

  const selectedMemory = memories.find((m) => m.id === selectedMemoryId);


  return (
    <div className="flex min-h-0 w-full flex-1">
      <SettingsSplitPane
        backLabel="Memories"
        detailTitle="Memory"
        listHeader={
          <div className="flex items-center justify-between w-full">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text)]">Memories</h2>
              <p className="text-xs text-[var(--muted)]">
                {memories.length} memor{memories.length !== 1 ? "ies" : "y"}
              </p>
            </div>
          </div>
        }
        listPanel={
          <div className="space-y-3">
            <SettingsAccordion
              title="Memory preferences"
              description="Automatic recall and storage limits"
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm text-[var(--text)]">Enable memories</div>
                    <div className="mt-0.5 text-xs leading-5 text-[var(--muted)]">Save and recall facts across conversations</div>
                  </div>
                  <label className="relative inline-flex shrink-0 cursor-pointer items-center">
                    <input
                      type="checkbox"
                      checked={settings?.memoriesEnabled ?? true}
                      onChange={(e) => saveSettings({ memoriesEnabled: e.target.checked })}
                      className="peer sr-only"
                    />
                    <span className="h-6 w-11 rounded-full bg-white/10 transition-colors after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-violet-500/60 peer-checked:after:translate-x-full" />
                  </label>
                </div>
                <div>
                  <label className={fieldLabel}>Maximum memories</label>
                  <Input
                    type="number"
                    min={1}
                    max={500}
                    value={settings?.memoriesMaxCount ?? 100}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (val >= 1 && val <= 500) saveSettings({ memoriesMaxCount: val });
                    }}
                    className="w-full text-sm"
                  />
                  <p className="mt-1.5 text-xs text-[var(--muted)]">Currently storing {memories.length}.</p>
                </div>
              </div>
            </SettingsAccordion>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search memories..."
                  className={`${inputLike} pl-10`}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.value}
                  type="button"
                  onClick={() => setFilterCategory(cat.value)}
                  className={`rounded-md px-2.5 py-1 text-[10px] font-medium transition-all duration-200 ${
                    filterCategory === cat.value
                      ? "bg-violet-500/15 text-violet-300 border border-violet-500/25"
                      : "bg-white/[0.03] text-[var(--muted)] border border-white/4 hover:bg-white/[0.06] hover:text-[var(--text)]"
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
            <div className="space-y-1.5">
              {memories.length === 0 ? (
                <div className="flex flex-col items-center py-12 text-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.03] border border-white/6 mb-3">
                    <Brain className="h-4 w-4 text-[var(--muted)]" />
                  </div>
                  <p className="text-xs text-[var(--muted)]">
                    No memories yet. The assistant will automatically save important facts about you as you chat.
                  </p>
                </div>
              ) : (
                memories.map((memory) => (
                  <ProfileCard
                    key={memory.id}
                    isActive={memory.id === selectedMemoryId}
                    onClick={() => handleSelectMemory(memory)}
                    title={memory.content.length > 80 ? `${memory.content.slice(0, 80)}...` : memory.content}
                    subtitle={formatRelativeTime(memory.updatedAt)}
                    badges={[{ variant: "violet", label: memory.category }]}
                  />
                ))
              )}
            </div>
          </div>
        }
        isDetailVisible={mobileDetailVisible}
        onBackAction={() => setMobileDetailVisible(false)}
        detailPanel={
          <div             className="w-full max-w-[720px] space-y-8">
            {selectedMemory ? (
              <>
                <div className="space-y-4">
                  <DetailHeader
                    title="Edit Memory"
                    summary={`Created ${formatRelativeTime(selectedMemory.createdAt)} · Updated ${formatRelativeTime(selectedMemory.updatedAt)}`}
                  />
                </div>

                <div className="space-y-5">
                  <div>
                    <label className={fieldLabel}>Content</label>
                    <Textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      placeholder="The fact to remember..."
                      rows={4}
                    />
                  </div>
                  <div>
                    <label className={fieldLabel}>Category</label>
                    <select
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value as MemoryCategory)}
                      className={selectLike}
                    >
                      <option value="personal">Personal</option>
                      <option value="preference">Preference</option>
                      <option value="work">Work</option>
                      <option value="location">Location</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" size="lg" className="min-h-11 px-5 text-sm md:min-h-10" onClick={saveMemory}>
                      Save
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="lg"
                      className="min-h-11 px-4 text-sm md:min-h-10"
                      onClick={() => {
                        setSelectedMemoryId(null);
                        setMobileDetailVisible(false);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                  {selectedMemory ? (
                    <button
                      type="button"
                      onClick={() => {
                        setPendingDeleteId(selectedMemory.id);
                        setDeleteConfirmOpen(true);
                      }}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm text-red-400/80 transition-colors hover:bg-red-500/[0.06] hover:text-red-300 md:min-h-10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.03] border border-white/6 mb-4">
                  <Brain className="h-5 w-5 text-[var(--muted)]" />
                </div>
                <p className="text-sm text-[var(--muted)]">
                  Select a memory to view and edit
                </p>
              </div>
            )}
          </div>
        }
      />
      <Toast
        visible={toast.visible}
        variant={toast.variant}
        message={toast.message}
      />
      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Delete memory?"
        description={
          <>
            <strong className="text-[var(--text)] font-medium">{selectedMemory?.content?.slice(0, 60) || "This memory"}</strong> will be permanently deleted. This action cannot be undone.
          </>
        }
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}
