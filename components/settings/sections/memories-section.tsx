"use client";

import { useEffect, useState, useCallback } from "react";
import { Brain, Search, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Toast } from "@/components/ui/toast";
import { useToastState } from "@/hooks/use-toast-state";
import type { AppSettings, MemoryCategory, UserMemory } from "@/lib/types";

import { SettingsSplitPane } from "../settings-split-pane";
import { ProfileCard } from "../profile-card";

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

  const fieldLabel = "block text-[13px] font-medium text-[var(--muted)] mb-1.5";
  const inputLike = "w-full rounded-xl border border-white/6 bg-white/4 px-4 py-3 text-sm text-[var(--text)] outline-none transition-all duration-200 focus:border-[var(--accent)]/40 focus:bg-white/6 focus:shadow-[0_0_0_3px_var(--accent-soft)]";
  const selectLike = `${inputLike} appearance-none bg-[url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2371717a%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-[length:1rem_1rem] bg-[right_0.75rem_center] bg-no-repeat pr-10`;
  const sectionTitle = "text-sm font-semibold text-[var(--text)]";
  const sectionDivider = "border-t border-white/[0.06]";

  return (
    <div className="min-h-0 p-4 md:h-full md:p-8 space-y-6">
      <div className="space-y-0">
        <div className="pb-5">
          <h3 className="text-base font-semibold text-[var(--text)]">Memory Settings</h3>
          <p className="mt-1 text-xs text-[var(--muted)]">
            The assistant automatically saves important facts about you across conversations.
          </p>
        </div>

        <div className={`${sectionDivider} py-5`}>
          <div className="space-y-4">
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <div className="text-[13px] text-[var(--text)]">Enable memories</div>
                <div className="mt-0.5 text-xs text-[var(--muted)]">Allow the assistant to save and recall facts about you</div>
              </div>
              <div className="w-full sm:w-auto sm:flex-shrink-0">
                <label className="relative inline-flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    checked={settings?.memoriesEnabled ?? true}
                    onChange={(e) => saveSettings({ memoriesEnabled: e.target.checked })}
                    className="peer sr-only"
                  />
                  <div className="h-5 w-9 rounded-full bg-white/10 peer-checked:bg-violet-500/60 transition-colors after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all peer-checked:after:translate-x-full" />
                </label>
              </div>
            </div>
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <div className="text-[13px] text-[var(--text)]">Max memories</div>
                <div className="mt-0.5 text-xs text-[var(--muted)]">Maximum number of memories (current: {memories.length})</div>
              </div>
              <div className="w-full sm:w-auto sm:flex-shrink-0">
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={settings?.memoriesMaxCount ?? 100}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (val >= 1 && val <= 500) saveSettings({ memoriesMaxCount: val });
                  }}
                  className="w-20 text-center text-sm"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <SettingsSplitPane
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
                  <div>
                    <h3 className="text-base font-semibold text-[var(--text)]">Edit Memory</h3>
                    <div className="mt-1 flex gap-4 text-xs text-[var(--muted)]">
                      <span>Created {formatRelativeTime(selectedMemory.createdAt)}</span>
                      <span>Updated {formatRelativeTime(selectedMemory.updatedAt)}</span>
                    </div>
                  </div>
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
                    <Button type="button" className="px-3 py-1.5 text-xs" onClick={saveMemory}>
                      Save
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="px-2.5 py-1.5 text-xs"
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
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-red-400/80 transition-colors hover:text-red-300"
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
