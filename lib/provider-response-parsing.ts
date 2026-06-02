import { normalizeLineBreaks } from "@/lib/text-utils";

export function getResponseText(output: unknown) {
  if (typeof output === "string") {
    return output;
  }

  if (
    output &&
    typeof output === "object" &&
    "output_text" in output &&
    typeof (output as { output_text?: string }).output_text === "string"
  ) {
    return (output as { output_text: string }).output_text;
  }

  if (
    output &&
    typeof output === "object" &&
    "output" in output &&
    Array.isArray((output as { output?: unknown[] }).output)
  ) {
    return (output as { output: unknown[] }).output
      .flatMap((item) => {
        if (
          item &&
          typeof item === "object" &&
          "content" in item &&
          Array.isArray((item as { content?: unknown[] }).content)
        ) {
          return (item as { content: Array<{ text?: string }> }).content
            .map((part) => part.text ?? "")
            .filter(Boolean);
        }

        return [];
      })
      .join("");
  }

  return "";
}

export function getResponseOutputItemMessageText(item: unknown) {
  if (
    !item ||
    typeof item !== "object" ||
    !("content" in item) ||
    !Array.isArray((item as { content?: unknown[] }).content)
  ) {
    return "";
  }

  return normalizeLineBreaks(
    (item as { content: unknown[] }).content
      .flatMap((part) => {
        if (!part || typeof part !== "object") {
          return [];
        }

        const text = "text" in part && typeof (part as { text?: string }).text === "string"
          ? (part as { text: string }).text
          : "";

        if (!text) {
          return [];
        }

        const type = "type" in part && typeof (part as { type?: string }).type === "string"
          ? (part as { type: string }).type
          : "";

        if (!type || type === "output_text" || type === "text") {
          return [text];
        }

        return [];
      })
      .join("")
  );
}

export function mergeRecoveredStreamText(current: string, recovered: string) {
  const nextText = normalizeLineBreaks(recovered);

  if (!nextText || nextText === current) {
    return {
      nextText: current,
      delta: ""
    };
  }

  if (nextText.startsWith(current)) {
    return {
      nextText,
      delta: nextText.slice(current.length)
    };
  }

  return {
    nextText,
    delta: ""
  };
}
