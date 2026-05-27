import type { Pluggable, PluggableList } from "unified";
import { defaultRemarkPlugins } from "streamdown";
import { PLUGIN_ORDER, type PluginName } from "../types";
import { isPluginEnabled } from "../feature-flags";
import remarkFixBlockSpacing from "./remark-fix-block-spacing";
import remarkExtractInlineThematicBreaks from "./remark-extract-inline-thematic-breaks";
import remarkSplitInlineTable from "./remark-split-inline-table";
import remarkFixInlineFences from "./remark-fix-inline-fences";
import remarkMergeUnclosedInlineCode from "./remark-merge-unclosed-inline-code";
import remarkCloseUnbalancedEmphasis from "./remark-close-unbalanced-emphasis";

const REGISTRY: Record<PluginName, Pluggable | undefined> = {
  "fix-block-spacing": remarkFixBlockSpacing,
  "extract-inline-thematic-breaks": remarkExtractInlineThematicBreaks,
  "split-inline-table": remarkSplitInlineTable,
  "fix-inline-fences": remarkFixInlineFences,
  "merge-unclosed-inline-code": remarkMergeUnclosedInlineCode,
  "close-unbalanced-emphasis": remarkCloseUnbalancedEmphasis,
  "normalize-mixed-emphasis": undefined,
  "normalize-list-indentation": undefined,
  "merge-orphaned-list-fragments": undefined,
  "renumber-ordered-lists": undefined,
  "tighten-lists": undefined,
  "normalize-blockquote-nesting": undefined,
};

const STREAMDOWN_DEFAULTS: PluggableList = Object.values(defaultRemarkPlugins) as PluggableList;

/**
 * Ordered list of remark plugins applied to assistant markdown. Starts with
 * Streamdown's built-in defaults (GFM, code-meta) so they are preserved when
 * remarkPlugins is passed explicitly, then appends any enabled AST plugins.
 * Each plugin is registered above in the order it should run. The array
 * filters out plugins disabled via the NEXT_PUBLIC_MARKDOWN_DISABLED_PLUGINS env var.
 */
export const MARKDOWN_REMARK_PLUGINS: PluggableList = [
  ...STREAMDOWN_DEFAULTS,
  ...PLUGIN_ORDER
    .filter((name) => isPluginEnabled(name) && REGISTRY[name] !== undefined)
    .map((name) => REGISTRY[name] as Pluggable),
];
