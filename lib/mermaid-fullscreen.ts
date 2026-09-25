const MERMAID_BLOCK_SELECTOR = '[data-streamdown="mermaid-block"]';
const MERMAID_CARD_SELECTOR = '[data-streamdown="mermaid-block"] > div:last-child';
const MERMAID_FULLSCREEN_BUTTON_SELECTOR =
  '[data-streamdown="mermaid-block-actions"] button[title*="fullscreen" i]';

export function openMermaidFullscreenFromCard(event: {
  target: EventTarget | null;
  detail?: number;
  stopPropagation?: () => void;
}): boolean {
  if ((event.detail ?? 0) > 1) return false;
  const target = event.target;
  if (!(target instanceof Element)) return false;
  const card = target.closest(MERMAID_CARD_SELECTOR);
  if (!card) return false;
  const button = card
    .closest(MERMAID_BLOCK_SELECTOR)
    ?.querySelector(MERMAID_FULLSCREEN_BUTTON_SELECTOR);
  if (!(button instanceof HTMLElement)) return false;
  button.click();
  event.stopPropagation?.();
  return true;
}
