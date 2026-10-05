const NBSP = "\u00a0";
const BULLET = "•";
const CHECKBOX_OPEN = "☐";
const CHECKBOX_DONE = "☑";
const QUOTE_MARK = "›";
const ELLIPSIS = "…";
const LINE_BREAK = "<br>";
const MAX_INDENT = 8;

const FENCE = /^\s{0,3}(`{3,}|~{3,})[^`\n]*$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;
const RULE = /^\s{0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const QUOTE = /^\s{0,3}>[ \t]?(.*)$/;
const LIST_ITEM = /^([ \t]*)(\d+[.)]|[-*+])([ \t]+)(.*)$/;
const TASK_ITEM = /^\[([ xX])\][ \t]*(.*)$/;
const TABLE_DIVIDER = /^\s*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?\s*$/;
const LINK = /^\[([^\]]*)\]\([ \t]*<?([^\s<>]+?)>?(?:[ \t]+(?:"[^"]*"|'[^']*'))?[ \t]*\)$/;
const INLINE =
  /!\[[^\]\n]*\]\((?:[^()\n]|\([^()\n]*\))*\)|\[[^\]\n]*\]\((?:[^()\n]|\([^()\n]*\))*\)|`[^`\n]*`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|_[^_\n]+_|<https?:\/\/[^>\s]+>|https?:\/\/[^\s<]*[^\s<.,;:!?)\]]/g;
const SPACES = /[ \t]{2,}|^ +/g;

export type NotifyMessageFormat = "html" | "text";

type Block =
  | { kind: "blank" }
  | { kind: "code"; text: string }
  | { kind: "line"; marker: string; text: string; indent: number; heading: boolean }
  | { kind: "table"; rows: string[] };

export function renderNotifyMessage(
  source: string,
  format: NotifyMessageFormat,
  maxChars?: number
): string {
  const rendered = renderBlocks(parseBlocks(source), format);
  return maxChars !== undefined && rendered.length > maxChars
    ? truncate(rendered, maxChars, format === "html")
    : rendered;
}

function parseBlocks(source: string): Block[] {
  const rawLines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let fence: string | null = null;

  for (let index = 0; index < rawLines.length; index += 1) {
    const raw = rawLines[index];

    if (fence) {
      if (FENCE.test(raw) && raw.trim().startsWith(fence[0])) {
        fence = null;
      } else {
        blocks.push({ kind: "code", text: raw });
      }
      continue;
    }

    const openingFence = FENCE.exec(raw);
    if (openingFence) {
      fence = openingFence[1];
      continue;
    }

    if (raw.trim() === "") {
      blocks.push({ kind: "blank" });
      continue;
    }

    if (RULE.test(raw)) {
      continue;
    }

    const heading = HEADING.exec(raw);
    if (heading) {
      blocks.push({ kind: "line", marker: "", text: heading[1], indent: 0, heading: true });
      continue;
    }

    const quote = QUOTE.exec(raw);
    if (quote) {
      blocks.push({
        kind: "line",
        marker: `${QUOTE_MARK} `,
        text: quote[1],
        indent: 0,
        heading: false
      });
      continue;
    }

    const listItem = LIST_ITEM.exec(raw);
    if (listItem) {
      const task = TASK_ITEM.exec(listItem[4]);
      blocks.push({
        kind: "line",
        marker: task
          ? `${task[1] === " " ? CHECKBOX_OPEN : CHECKBOX_DONE} `
          : isBullet(listItem[2])
            ? `${BULLET} `
            : `${listItem[2]} `,
        text: task ? task[2] : listItem[4],
        indent: listItem[1].length,
        heading: false
      });
      continue;
    }

    if (raw.includes("|") && TABLE_DIVIDER.test(rawLines[index + 1] ?? "")) {
      const rows = [raw];
      index += 1;
      while (
        index + 1 < rawLines.length &&
        rawLines[index + 1].includes("|") &&
        !TABLE_DIVIDER.test(rawLines[index + 1])
      ) {
        index += 1;
        rows.push(rawLines[index]);
      }
      blocks.push({ kind: "table", rows });
      continue;
    }

    blocks.push({ kind: "line", marker: "", text: raw, indent: 0, heading: false });
  }

  return blocks;
}

function renderBlocks(blocks: Block[], format: NotifyMessageFormat): string {
  const lines: string[] = [];

  for (const block of blocks) {
    if (block.kind === "blank") {
      if (lines.length > 0 && lines.at(-1) !== "") {
        lines.push("");
      }
      continue;
    }
    if (block.kind === "table") {
      lines.push(...renderTable(block.rows, format));
      continue;
    }
    if (block.kind === "code") {
      lines.push(format === "html" ? block.text.replace(SPACES, repeatNbsp) : block.text);
      continue;
    }
    const spacing = (format === "html" ? NBSP : " ").repeat(Math.min(block.indent, MAX_INDENT));
    const body = format === "html" ? inlineHtml(block.text) : stripInline(block.text);
    const styled = block.heading && format === "html" ? `<b>${body}</b>` : body;
    lines.push(`${spacing}${block.marker}${styled}`);
  }

  while (lines.at(-1) === "") {
    lines.pop();
  }
  return lines.join(format === "html" ? LINE_BREAK : "\n");
}

function renderTable(rows: string[], format: NotifyMessageFormat): string[] {
  return rows.map((row, rowIndex) => {
    const rendered = format === "html" ? inlineHtml(row) : stripInline(row);
    return rowIndex === 0 && format === "html" ? `<b>${rendered}</b>` : rendered;
  });
}

function mapInline(
  text: string,
  renderGap: (gap: string) => string,
  renderToken: (token: string) => string
): string {
  INLINE.lastIndex = 0;
  let rendered = "";
  let cursor = 0;
  let match = INLINE.exec(text);
  while (match) {
    rendered += renderGap(text.slice(cursor, match.index));
    rendered += renderToken(match[0]);
    cursor = match.index + match[0].length;
    match = INLINE.exec(text);
  }
  return rendered + renderGap(text.slice(cursor));
}

function inlineHtml(text: string): string {
  return mapInline(text, escapeHtml, renderHtmlToken);
}

function stripInline(text: string): string {
  return mapInline(text, (gap) => gap, renderPlainToken);
}

function renderHtmlToken(token: string): string {
  if (token.startsWith("![")) {
    return escapeHtml(LINK.exec(token.slice(1))?.[1] ?? "");
  }
  if (token.startsWith("`")) {
    return escapeHtml(token.slice(1, -1));
  }
  if (token.startsWith("~~")) {
    return escapeHtml(token.slice(2, -2));
  }
  if (token.startsWith("**") || token.startsWith("__")) {
    return `<b>${escapeHtml(token.slice(2, -2))}</b>`;
  }
  if (token.startsWith("*") || token.startsWith("_")) {
    return `<i>${escapeHtml(token.slice(1, -1))}</i>`;
  }
  if (token.startsWith("[")) {
    const link = LINK.exec(token);
    return link && isHttpUrl(link[2])
      ? `<a href="${escapeHtml(link[2])}">${escapeHtml(link[1])}</a>`
      : escapeHtml(link?.[1] ?? token);
  }
  return renderAnchor(token);
}

function renderPlainToken(token: string): string {
  if (token.startsWith("![")) {
    return LINK.exec(token.slice(1))?.[1] ?? "";
  }
  if (token.startsWith("`") || token.startsWith("~~")) {
    return token.slice(token.startsWith("`") ? 1 : 2, token.startsWith("`") ? -1 : -2);
  }
  if (token.startsWith("**") || token.startsWith("__")) {
    return token.slice(2, -2);
  }
  if (token.startsWith("*") || token.startsWith("_")) {
    return token.slice(1, -1);
  }
  if (token.startsWith("[")) {
    return LINK.exec(token)?.[1] ?? token;
  }
  return token.startsWith("<") ? token.slice(1, -1) : token;
}

function renderAnchor(token: string): string {
  const url = token.startsWith("<") ? token.slice(1, -1) : token;
  return isHttpUrl(url) ? `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>` : escapeHtml(url);
}

function isBullet(marker: string): boolean {
  return marker === "-" || marker === "*" || marker === "+";
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(value);
}

function repeatNbsp(run: string): string {
  return NBSP.repeat(run.length);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function truncate(rendered: string, maxChars: number, isHtml: boolean): string {
  const room = maxChars - ELLIPSIS.length;
  if (room <= 0) {
    return "";
  }
  const cut = rendered.lastIndexOf(isHtml ? LINE_BREAK : "\n", room);
  if (cut > 0) {
    return `${rendered.slice(0, cut)}${ELLIPSIS}`;
  }
  const plain = isHtml ? escapeHtml(rendered.replace(/<[^>]*>/g, "")) : rendered;
  return `${plain.slice(0, room).trimEnd()}${ELLIPSIS}`;
}
