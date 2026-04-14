"use client";

function prefersLegacyCopyGesture() {
  if (typeof navigator === "undefined") {
    return false;
  }

  const userAgent = navigator.userAgent ?? "";
  const maxTouchPoints = navigator.maxTouchPoints ?? 0;
  const isiPhoneOrIPod = /iPhone|iPod/i.test(userAgent);
  const isiPad = /iPad/i.test(userAgent);
  const isIPadDesktopMode = /Macintosh/i.test(userAgent) && maxTouchPoints > 1;

  return isiPhoneOrIPod || isiPad || isIPadDesktopMode;
}

function legacyWriteTextToClipboard(text: string) {
  if (typeof document === "undefined") {
    throw new Error("Clipboard unavailable");
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  try {
    if (typeof document.execCommand !== "function" || !document.execCommand("copy")) {
      throw new Error("Clipboard unavailable");
    }
  } finally {
    textarea.remove();
  }
}

export async function writeTextToClipboard(text: string) {
  if (prefersLegacyCopyGesture()) {
    try {
      legacyWriteTextToClipboard(text);
      return;
    } catch {}
  }

  try {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      throw new Error("Clipboard unavailable");
    }

    await navigator.clipboard.writeText(text);
  } catch {
    legacyWriteTextToClipboard(text);
  }
}

export async function writeRichTextToClipboard(input: { html: string; text: string }) {
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      throw new Error("Clipboard unavailable");
    }

    if (
      typeof ClipboardItem !== "undefined" &&
      typeof navigator.clipboard.write === "function" &&
      input.html
    ) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([input.text], { type: "text/plain" }),
          "text/html": new Blob([input.html], { type: "text/html" })
        })
      ]);
      return;
    }

    await navigator.clipboard.writeText(input.text);
  } catch {
    legacyWriteTextToClipboard(input.text);
  }
}
