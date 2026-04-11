"use client";

import { useEffect, useState, useCallback } from "react";
import { Brain, Search, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { AppSettings, MemoryCategory, UserMemory } from "@/lib/types";

import { SettingsSplitPane } from "../settings-split-pane";
import { ProfileCard } from "../profile-card";
import { SettingsCard } from "../settings-card";
import { SettingRow } from "../setting-row";

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
    const res = await fetch("/api/settings/general", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...settings, ...patch })
    });
    const data = (await res.json()) as { settings: AppSettings };
    setSettings(data.settings);
  }

  async function saveMemory() {
    if (!selectedMemoryId || !editContent.trim()) return;

    await fetch(`/api/memories/${selectedMemoryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: editContent.trim(),
        category: editCategory
      })
    });

    const params = new URLSearchParams();
    if (filterCategory !== "all") params.set("category", filterCategory);
    if (searchQuery.trim()) params.set("search", searchQuery.trim());
    await fetchMemories(params.toString() || undefined);
    setSelectedMemoryId(null);
    setMobileDetailVisible(false);
  }

  async function deleteMemory(id: string) {
    await fetch(`/api/memories/${id}`, { method: "DELETE" });
    setMemories((prev) => prev.filter((m) => m.id !== id));
    if (selectedMemoryId === id) {
      setSelectedMemoryId(null);
      setMobileDetailVisible(false);
    }
  }

  function handleSelectMemory(memory: UserMemory) {
    setSelectedMemoryId(memory.id);
    setEditContent(memory.content);
    setEditCategory(memory.category);
    setMobileDetailVisible(true);
  }

  const selectedMemory = memories.find((m) => m.id === selectedMemoryId);
  const labelClass = "text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-[#71717a]";

  return (
    <div className="min-h-0 p-4 md:h-full md:p-8 space-y-6">
      <SettingsCard
        title="Memory Settings"
        description="The assistant automatically saves important facts about you across conversations."
      >
        <div className="space-y-4">
          <SettingRow label="Enable memories" description="Allow the assistant to save and recall facts about you">
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={settings?.memoriesEnabled ?? true}
                onChange={(e) => saveSettings({ memoriesEnabled: e.target.checked })}
                className="peer sr-only"
              />
              <div className="h-5 w-9 rounded-full bg-white/10 peer-checked:bg-violet-500/60 transition-colors after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all peer-checked:after:translate-x-full" />
            </label>
          </SettingRow>
          <SettingRow label="Max memories" description={`Maximum number of memories (current: ${memories.length})`}>
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
          </SettingRow>
        </div>
      </SettingsCard>

      <SettingsSplitPane
        listHeader={
          <div className="flex items-center justify-between w-full">
            <div>
              <h2 className="text-[0.9rem] font-semibold text-[#f4f4f5]">Memories</h2>
              <p className="text-[0.68rem] text-[#52525b]">
                {memories.length} memor{memories.length !== 1 ? "ies" : "y"}
              </p>
            </div>
          </div>
        }
        listPanel={
          <div className="space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#52525b]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search memories..."
                  className="w-full rounded-lg border border-white/6 bg-white/[0.03] py-2 pl-8 pr-3 text-xs text-[#f4f4f5] placeholder:text-[#52525b] outline-none focus:border-violet-500/30 transition-colors"
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
                      : "bg-white/[0.03] text-[#71717a] border border-white/4 hover:bg-white/[0.06] hover:text-[#a1a1aa]"
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
                    <Brain className="h-4 w-4 text-[#52525b]" />
                  </div>
                  <p className="text-xs text-[#52525b]">
                    No memories yet. The assistant will automatically save important facts about you as you chat.
                  </p>
                </div>
              ) : (
                memories.map((memory) => (
                  <div key={memory.id} className="group relative">
                    <ProfileCard
                      isActive={memory.id === selectedMemoryId}
                      onClick={() => handleSelectMemory(memory)}
                      title={memory.content.length > 80 ? `${memory.content.slice(0, 80)}...` : memory.content}
                      subtitle={formatRelativeTime(memory.updatedAt)}
                      badges={[{ variant: "violet", label: memory.category }]}
                      rightSlot={
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteMemory(memory.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 flex h-6 w-6 items-center justify-center rounded-md text-[#52525b] hover:text-red-400 hover:bg-red-500/10 transition-all"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      }
                    />
                  </div>
                ))
              )}
            </div>
          </div>
        }
        isDetailVisible={mobileDetailVisible}
        onBackAction={() => setMobileDetailVisible(false)}
        detailPanel={
          <div className="max-w-[560px] space-y-6">
            {selectedMemory ? (
              <>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[1.1rem] font-semibold text-[#f4f4f5]">Edit Memory</h3>
                    <Button
                      type="button"
                      variant="danger"
                      onClick={() => deleteMemory(selectedMemory.id)}
                      className="gap-1.5 px-3 py-1.5 text-xs"
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete
                    </Button>
                  </div>
                  <div className="flex gap-4 text-xs text-[#52525b]">
                    <span>Created {formatRelativeTime(selectedMemory.createdAt)}</span>
                    <span>Updated {formatRelativeTime(selectedMemory.updatedAt)}</span>
                  </div>
                </div>

                <div className="space-y-5">
                  <div>
                    <label className={labelClass}>Content</label>
                    <Textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      placeholder="The fact to remember..."
                      rows={4}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Category</label>
                    <select
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value as MemoryCategory)}
                      className="w-full rounded-xl border border-white/6 bg-white/4 px-4 py-3 text-sm text-[var(--text)] outline-none transition-all duration-200 focus:border-violet-500/30"
                    >
                      <option value="personal">Personal</option>
                      <option value="preference">Preference</option>
                      <option value="work">Work</option>
                      <option value="location">Location</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <Button type="button" onClick={saveMemory}>
                    Save
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setSelectedMemoryId(null);
                      setMobileDetailVisible(false);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.03] border border-white/6 mb-4">
                  <Brain className="h-5 w-5 text-[#52525b]" />
                </div>
                <p className="text-[0.85rem] text-[#71717a]">
                  Select a memory to view and edit
                </p>
              </div>
            )}
          </div>
        }
      />
    </div>
  );
}
