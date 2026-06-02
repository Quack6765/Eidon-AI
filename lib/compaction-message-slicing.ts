import { groupCompletedTurns } from "@/lib/compaction-turns";
import type { Message } from "@/lib/types";

export function getVisibleConversationMessages(messages: Message[]) {
  return messages.filter((message) => !message.compactedAt);
}

export function getCompletedTurns(messages: Message[]) {
  return groupCompletedTurns(getVisibleConversationMessages(messages));
}

export function getLatestVisibleUserMessage(messages: Message[]) {
  return [...messages]
    .reverse()
    .find((message) => message.role === "user" && !message.compactedAt) ?? null;
}

export function getFreshConversationMessages(messages: Message[], freshCompletedTurnCount: number) {
  const visibleMessages = getVisibleConversationMessages(messages);
  const completedTurns = getCompletedTurns(messages);
  const selectedTurns = completedTurns.slice(
    Math.max(0, completedTurns.length - freshCompletedTurnCount)
  );
  const freshMessages = selectedTurns.flatMap((turn) => [turn.user, turn.assistant]);
  const latestUserMessage = getLatestVisibleUserMessage(visibleMessages);

  if (latestUserMessage && !freshMessages.some((message) => message.id === latestUserMessage.id)) {
    freshMessages.push(latestUserMessage);
  }

  return freshMessages;
}

export function getCompactionEligibleMessages(messages: Message[], freshTailCount: number) {
  const completedTurns = getCompletedTurns(messages);

  if (completedTurns.length <= freshTailCount) {
    return [];
  }

  return completedTurns
    .slice(0, completedTurns.length - freshTailCount)
    .flatMap((turn) => [turn.user, turn.assistant]);
}
