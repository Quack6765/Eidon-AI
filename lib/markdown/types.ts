import type { Plugin } from "unified";
import type { Root } from "mdast";

export type MarkdownRemarkPlugin = Plugin<[], Root>;

export interface PluginMetadata {
  name: PluginName;
  description: string;
  /** Order in the pipeline — lower runs first. */
  order: number;
}

export type PluginName =
  | "fix-block-spacing"
  | "extract-inline-thematic-breaks"
  | "split-inline-table"
  | "fix-inline-fences"
  | "merge-unclosed-inline-code"
  | "close-unbalanced-emphasis"
  | "normalize-mixed-emphasis"
  | "split-inline-list-markers"
  | "normalize-list-indentation"
  | "merge-orphaned-list-fragments"
  | "renumber-ordered-lists"
  | "tighten-lists"
  | "normalize-blockquote-nesting";

export const PLUGIN_ORDER: readonly PluginName[] = [
  "fix-block-spacing",
  "extract-inline-thematic-breaks",
  "split-inline-table",
  "fix-inline-fences",
  "merge-unclosed-inline-code",
  "close-unbalanced-emphasis",
  "normalize-mixed-emphasis",
  "split-inline-list-markers",
  "normalize-list-indentation",
  "merge-orphaned-list-fragments",
  "renumber-ordered-lists",
  "tighten-lists",
  "normalize-blockquote-nesting",
] as const;
