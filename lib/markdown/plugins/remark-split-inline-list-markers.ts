import type { Plugin } from "unified";
import type {
  Root,
  ListItem,
  Paragraph,
  Heading,
  List,
  PhrasingContent,
  Parent,
  BlockContent,
} from "mdast";
import { visit, SKIP } from "unist-util-visit";
import { flattenInline, parseInline } from "../ast-helpers";

const INLINE_MARKER_MULTI = /\s\*\s(?=\S)/g;
const INLINE_MARKER_SINGLE = /(?:\s|(?<=\w|\)|\]))\*\s(?=[A-Z`])/g;
const MIN_MARKERS_MULTI = 2;

const BLOCK_LIST_MARKER = /\*\s+(?=[A-Z`])/g;
const BLOCK_ORDERED_MARKER = /(?<![\d.])\d{1,3}\.\s+(?=[A-Z`])|(?<=\.\d)\d\.\s+(?=[A-Z`])/g;
const ORDERED_BOUNDARY = /(?<!\d)\d{1,3}\.\s+$/;
const STAR_BOUNDARY = /\*\s+$/;
const TASK_INLINE_MARKER = /\s?-\s+\[([ xX])?\]\s+/g;
const MALFORMED_TASK_MARKER = /^\[([ \t]*[xX][ \t]*|[ \t]{2,})\]([ \t]+|$)/;

const MIN_ORDERED_SEGMENT_LEN = 5;

type MarkerPos = { childIdx: number; start: number; end: number };

function hasBalancedStrong(s: string): boolean {
  return ((s.match(/\*\*/g) || []).length) % 2 === 0;
}

function findBlockMarkers(children: readonly PhrasingContent[]): MarkerPos[] {
  const markers: MarkerPos[] = [];
  for (let i = 0; i < children.length; i++) {
    const c = children[i];
    if (c.type !== "text") continue;
    BLOCK_LIST_MARKER.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = BLOCK_LIST_MARKER.exec(c.value)) !== null) {
      markers.push({
        childIdx: i,
        start: m.index,
        end: m.index + m[0].length,
      });
    }
    const boundaryMatch = c.value.match(STAR_BOUNDARY);
    if (
      boundaryMatch &&
      i + 1 < children.length &&
      children[i + 1].type === "inlineCode"
    ) {
      markers.push({
        childIdx: i,
        start: c.value.length - boundaryMatch[0].length,
        end: c.value.length,
      });
    }
  }
  return markers;
}

function findOrderedBlockMarkers(
  children: readonly PhrasingContent[],
): MarkerPos[] {
  const markers: MarkerPos[] = [];
  for (let i = 0; i < children.length; i++) {
    const c = children[i];
    if (c.type !== "text") continue;
    BLOCK_ORDERED_MARKER.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = BLOCK_ORDERED_MARKER.exec(c.value)) !== null) {
      markers.push({
        childIdx: i,
        start: m.index,
        end: m.index + m[0].length,
      });
    }
    const boundary = c.value.match(ORDERED_BOUNDARY);
    if (
      boundary &&
      i + 1 < children.length &&
      children[i + 1].type === "inlineCode"
    ) {
      markers.push({
        childIdx: i,
        start: c.value.length - boundary[0].length,
        end: c.value.length,
      });
    }
  }
  return markers;
}

function sliceChildren(
  children: readonly PhrasingContent[],
  startChildIdx: number,
  startOffset: number,
  endChildIdx: number,
  endOffset: number,
): PhrasingContent[] {
  const result: PhrasingContent[] = [];
  for (let i = startChildIdx; i <= endChildIdx; i++) {
    const c = children[i];
    if (c.type === "text") {
      const s = i === startChildIdx ? startOffset : 0;
      const e = i === endChildIdx ? endOffset : c.value.length;
      const sliced = c.value.slice(s, e);
      if (sliced) result.push({ type: "text", value: sliced });
    } else {
      result.push(c);
    }
  }
  return result;
}

function trimLeading(children: PhrasingContent[]): PhrasingContent[] {
  if (children.length === 0) return children;
  const first = children[0];
  if (first.type === "text") {
    const trimmed = first.value.replace(/^\s+/, "");
    if (!trimmed) return trimLeading(children.slice(1));
    return [{ type: "text", value: trimmed }, ...children.slice(1)];
  }
  return children;
}

function trimTrailing(children: PhrasingContent[]): PhrasingContent[] {
  if (children.length === 0) return children;
  const last = children[children.length - 1];
  if (last.type === "text") {
    const trimmed = last.value.replace(/\s+$/, "");
    if (!trimmed) return trimTrailing(children.slice(0, -1));
    return [...children.slice(0, -1), { type: "text", value: trimmed }];
  }
  return children;
}

function buildListFromSegments(
  segments: PhrasingContent[][],
  ordered: boolean,
): List {
  const items: ListItem[] = segments.map((seg) => ({
    type: "listItem",
    spread: false,
    children: [
      {
        type: "paragraph",
        children: seg,
      } as Paragraph,
    ],
  }));
  return {
    type: "list",
    ordered,
    spread: false,
    ...(ordered ? { start: 1 } : {}),
    children: items,
  };
}

function segmentChildren(
  children: readonly PhrasingContent[],
  markers: MarkerPos[],
): PhrasingContent[][] {
  const segments: PhrasingContent[][] = [];
  let prevChild = 0;
  let prevOffset = 0;
  for (const m of markers) {
    segments.push(
      trimTrailing(
        sliceChildren(children, prevChild, prevOffset, m.childIdx, m.start),
      ),
    );
    prevChild = m.childIdx;
    prevOffset = m.end;
  }
  const lastChildIdx = children.length - 1;
  const lastChild = children[lastChildIdx];
  const lastEnd = lastChild.type === "text" ? lastChild.value.length : 0;
  segments.push(
    trimTrailing(
      sliceChildren(children, prevChild, prevOffset, lastChildIdx, lastEnd),
    ),
  );
  return segments;
}

function firstMarkerDigits(
  children: readonly PhrasingContent[],
  markers: MarkerPos[],
): string | null {
  if (markers.length === 0) return null;
  const m = markers[0];
  const c = children[m.childIdx];
  if (c.type !== "text") return null;
  const matched = c.value.slice(m.start, m.end);
  const digitMatch = matched.match(/^\d+/);
  return digitMatch ? digitMatch[0] : null;
}

function segmentTextLength(seg: PhrasingContent[]): number {
  return flattenInline(seg).trim().length;
}

function splitBlockOnMarkers<T extends Heading | Paragraph>(
  node: T,
  markers: MarkerPos[],
  index: number,
  parent: Parent,
  ordered: boolean,
): boolean {
  const segments = segmentChildren(node.children, markers);
  const headSegment = segments[0];
  const listSegments = segments
    .slice(1)
    .map(trimLeading)
    .filter((s) => s.length > 0);
  if (listSegments.length === 0) return false;
  if (ordered && listSegments.some((s) => segmentTextLength(s) < MIN_ORDERED_SEGMENT_LEN)) {
    return false;
  }

  const replacements: (Heading | Paragraph | List)[] = [];
  if (headSegment.length > 0) {
    if (node.type === "heading") {
      replacements.push({
        type: "heading",
        depth: node.depth,
        children: headSegment,
      });
    } else {
      replacements.push({
        type: "paragraph",
        children: headSegment,
      });
    }
  }
  replacements.push(buildListFromSegments(listSegments, ordered));

  parent.children.splice(index, 1, ...replacements);
  return true;
}

function isHighConfidenceSingleMarker(
  children: readonly PhrasingContent[],
  marker: MarkerPos,
): boolean {
  const c = children[marker.childIdx];
  if (c.type !== "text") return false;
  const before = c.value.slice(0, marker.start);
  if (/[A-Za-z]:\s*$/.test(before)) return true;
  if (/[A-Za-z][ \t]{2,}$/.test(before)) return true;
  return false;
}

function nestOrderedSubListInItem(
  item: ListItem,
  markers: MarkerPos[],
  allowSingle = false,
): boolean {
  const firstChild = item.children[0];
  if (!firstChild || firstChild.type !== "paragraph") return false;
  const segments = segmentChildren(firstChild.children, markers);
  const headSegment = trimTrailing(segments[0]);
  const subSegments = segments
    .slice(1)
    .map(trimLeading)
    .filter((s) => s.length > 0);
  if (subSegments.length < (allowSingle ? 1 : 2)) return false;
  if (segmentTextLength(headSegment) < 3) return false;
  if (subSegments.some((s) => segmentTextLength(s) < MIN_ORDERED_SEGMENT_LEN)) {
    return false;
  }

  const newChildren: BlockContent[] = [
    { type: "paragraph", children: headSegment },
    buildListFromSegments(subSegments, true),
    ...(item.children.slice(1) as BlockContent[]),
  ];
  item.children = newChildren;
  return true;
}

const remarkSplitInlineListMarkers: Plugin<[], Root> = () => {
  return (tree) => {
    visit(tree, "listItem", (item: ListItem, index, parent) => {
      if (index === undefined || !parent || parent.type !== "list") return;
      const firstChild = item.children[0];
      if (!firstChild || firstChild.type !== "paragraph") return;

      const combined = flattenInline(firstChild.children);
      const multiMatches = combined.match(INLINE_MARKER_MULTI);
      const useMulti = !!(multiMatches && multiMatches.length >= MIN_MARKERS_MULTI);
      const pattern = useMulti ? INLINE_MARKER_MULTI : INLINE_MARKER_SINGLE;
      const minSegments = useMulti ? MIN_MARKERS_MULTI + 1 : 2;

      const allMatches = combined.match(pattern);
      if (!allMatches || allMatches.length === 0) return;

      const segments = combined
        .split(pattern)
        .map((s) => s.trim())
        .filter(Boolean);
      if (segments.length < minSegments) return;
      if (segments.some((s) => !hasBalancedStrong(s))) return;

      const newItems: ListItem[] = segments.map((seg) => ({
        type: "listItem",
        spread: false,
        children: [
          {
            type: "paragraph",
            children: parseInline(seg),
          } as Paragraph,
        ],
      }));

      if (item.children.length > 1) {
        newItems[newItems.length - 1].children.push(...item.children.slice(1));
      }

      parent.children.splice(index, 1, ...newItems);
    });

    visit(tree, "listItem", (item: ListItem) => {
      const firstChild = item.children[0];
      if (!firstChild || firstChild.type !== "paragraph") return;
      const markers = findOrderedBlockMarkers(firstChild.children);
      if (markers.length === 0) return;
      if (firstMarkerDigits(firstChild.children, markers) !== "1") return;
      if (markers.length >= 2) {
        nestOrderedSubListInItem(item, markers);
        return;
      }
      if (isHighConfidenceSingleMarker(firstChild.children, markers[0])) {
        nestOrderedSubListInItem(item, markers, true);
      }
    });

    visit(tree, "listItem", (item: ListItem) => {
      if (item.checked !== null && item.checked !== undefined) return;
      const firstChild = item.children[0];
      if (!firstChild || firstChild.type !== "paragraph") return;
      const firstText = firstChild.children[0];
      if (!firstText || firstText.type !== "text") return;
      const mm = firstText.value.match(MALFORMED_TASK_MARKER);
      if (!mm) return;
      item.checked = /[xX]/.test(mm[1]);
      firstText.value = firstText.value.slice(mm[0].length);
    });

    visit(tree, "listItem", (item: ListItem, index, parent) => {
      if (index === undefined || !parent || parent.type !== "list") return;
      if (item.checked === null || item.checked === undefined) return;
      const firstChild = item.children[0];
      if (!firstChild || firstChild.type !== "paragraph") return;

      const raw = flattenInline(firstChild.children);
      const matches: Array<{ start: number; end: number; checked: boolean | null }> = [];
      TASK_INLINE_MARKER.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = TASK_INLINE_MARKER.exec(raw)) !== null) {
        const inner = m[1];
        const checked = inner === "x" || inner === "X" ? true : inner === " " || inner === undefined ? false : null;
        matches.push({ start: m.index, end: m.index + m[0].length, checked });
      }
      if (matches.length === 0) return;

      const segments: { text: string; checked: boolean | null }[] = [];
      let last = 0;
      let prevChecked: boolean | null = item.checked ?? false;
      for (const mt of matches) {
        segments.push({ text: raw.slice(last, mt.start).trim(), checked: prevChecked });
        last = mt.end;
        prevChecked = mt.checked;
      }
      segments.push({ text: raw.slice(last).trim(), checked: prevChecked });

      const filtered = segments.filter((s) => s.text.length > 0);
      if (filtered.length < 2) return;

      const newItems: ListItem[] = filtered.map((seg) => ({
        type: "listItem",
        spread: false,
        checked: seg.checked,
        children: [
          {
            type: "paragraph",
            children: parseInline(seg.text),
          } as Paragraph,
        ],
      }));

      if (item.children.length > 1) {
        newItems[newItems.length - 1].children.push(...item.children.slice(1));
      }

      parent.children.splice(index, 1, ...newItems);
    });

    visit(tree, "list", (list, _listIdx, listParent) => {
      if (!listParent || listParent.type !== "listItem") return;
      if (!list.ordered) return;
      const newItems: ListItem[] = [];
      for (const item of list.children) {
        const firstChild = item.children[0];
        if (!firstChild || firstChild.type !== "paragraph") {
          newItems.push(item);
          continue;
        }
        const markers = findOrderedBlockMarkers(firstChild.children);
        if (markers.length < 2) {
          newItems.push(item);
          continue;
        }
        const segments = segmentChildren(firstChild.children, markers)
          .map(trimLeading)
          .map(trimTrailing)
          .filter((s) => s.length > 0);
        if (segments.length < 2) {
          newItems.push(item);
          continue;
        }
        if (segments.some((s) => segmentTextLength(s) < MIN_ORDERED_SEGMENT_LEN)) {
          newItems.push(item);
          continue;
        }
        for (let i = 0; i < segments.length; i++) {
          const isLast = i === segments.length - 1;
          newItems.push({
            type: "listItem",
            spread: false,
            children: [
              { type: "paragraph", children: segments[i] } as Paragraph,
              ...(isLast ? (item.children.slice(1) as BlockContent[]) : []),
            ],
          });
        }
      }
      list.children = newItems;
    });

    visit(tree, "heading", (node: Heading, index, parent) => {
      if (index === undefined || !parent) return;
      const starMarkers = findBlockMarkers(node.children);
      if (starMarkers.length >= 1) {
        const changed = splitBlockOnMarkers(node, starMarkers, index, parent as Parent, false);
        if (changed) return [SKIP, index];
      }
      const orderedMarkers = findOrderedBlockMarkers(node.children);
      if (
        orderedMarkers.length >= 2 &&
        firstMarkerDigits(node.children, orderedMarkers) === "1"
      ) {
        const changed = splitBlockOnMarkers(node, orderedMarkers, index, parent as Parent, true);
        if (changed) return [SKIP, index];
      }
    });

    visit(tree, "paragraph", (node: Paragraph, index, parent) => {
      if (index === undefined || !parent) return;
      if (parent.type === "listItem") return;
      const starMarkers = findBlockMarkers(node.children);
      if (starMarkers.length >= 2) {
        const changed = splitBlockOnMarkers(node, starMarkers, index, parent as Parent, false);
        if (changed) return [SKIP, index];
      }
      const orderedMarkers = findOrderedBlockMarkers(node.children);
      if (
        orderedMarkers.length >= 2 &&
        firstMarkerDigits(node.children, orderedMarkers) === "1"
      ) {
        const changed = splitBlockOnMarkers(node, orderedMarkers, index, parent as Parent, true);
        if (changed) return [SKIP, index];
      }
    });
  };
};

export default remarkSplitInlineListMarkers;
