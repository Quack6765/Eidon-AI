import type { Conversation, ConversationSearchResult } from "@/lib/types";

export type SidebarConversation = ConversationSearchResult;

export function compareConversations(left: Conversation, right: Conversation) {
  if (left.updatedAt === right.updatedAt) {
    return right.id.localeCompare(left.id);
  }
  return left.updatedAt > right.updatedAt ? -1 : 1;
}

export function mergeConversations(current: Conversation[], incoming: Conversation[]) {
  const merged = new Map(current.map((conversation) => [conversation.id, conversation]));
  incoming.forEach((conversation) => {
    merged.set(conversation.id, conversation);
  });
  return [...merged.values()].sort(compareConversations);
}

export function getConversationSectionLabel(timestamp: string, now: Date) {
  const current = new Date(now);
  current.setHours(0, 0, 0, 0);

  const updatedAt = new Date(timestamp);
  const updatedDay = new Date(updatedAt);
  updatedDay.setHours(0, 0, 0, 0);

  if (updatedDay.getTime() === current.getTime()) {
    return "Today";
  }

  const yesterday = new Date(current);
  yesterday.setDate(yesterday.getDate() - 1);
  if (updatedDay.getTime() === yesterday.getTime()) {
    return "Yesterday";
  }

  const weekStart = new Date(current);
  const offset = (weekStart.getDay() + 6) % 7;
  weekStart.setDate(weekStart.getDate() - offset);
  if (updatedDay >= weekStart) {
    return "This Week";
  }

  const monthStart = new Date(current.getFullYear(), current.getMonth(), 1);
  if (updatedDay >= monthStart) {
    return "This Month";
  }

  return "Older";
}

export function buildConversationSections(conversations: SidebarConversation[]) {
  const sections = new Map<string, SidebarConversation[]>();
  const now = new Date();

  conversations.forEach((conversation) => {
    const label = getConversationSectionLabel(conversation.updatedAt, now);
    const list = sections.get(label) ?? [];
    list.push(conversation);
    sections.set(label, list);
  });

  return ["Today", "Yesterday", "This Week", "This Month", "Older"]
    .map((label) => ({
      label,
      conversations: sections.get(label) ?? []
    }))
    .filter((section) => section.conversations.length > 0);
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function highlightMatch(text: string, query: string): string {
  if (!query) {
    return escapeHtml(text);
  }

  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const splitRegex = new RegExp(`(${escapedQuery})`, "gi");
  const wholeMatchRegex = new RegExp(`^${escapedQuery}$`, "i");

  return text
    .split(splitRegex)
    .map((segment) =>
      wholeMatchRegex.test(segment)
        ? `<mark class="bg-[var(--accent)]/30 text-white rounded px-0.5">${escapeHtml(segment)}</mark>`
        : escapeHtml(segment)
    )
    .join("");
}
