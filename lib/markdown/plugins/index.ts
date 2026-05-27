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
import remarkNormalizeMixedEmphasis from "./remark-normalize-mixed-emphasis";
import remarkNormalizeListIndentation from "./remark-normalize-list-indentation";
import remarkMergeOrphanedListFragments from "./remark-merge-orphaned-list-fragments";
import remarkRenumberOrderedLists from "./remark-renumber-ordered-lists";
import remarkTightenLists from "./remark-tighten-lists";
import remarkNormalizeBlockquoteNesting from "./remark-normalize-blockquote-nesting";

const REGISTRY: Record<PluginName, Pluggable | undefined> = {
  "fix-block-spacing": remarkFixBlockSpacing,
  "extract-inline-thematic-breaks": remarkExtractInlineThematicBreaks,
  "split-inline-table": remarkSplitInlineTable,
  "fix-inline-fences": remarkFixInlineFences,
  "merge-unclosed-inline-code": remarkMergeUnclosedInlineCode,
  "close-unbalanced-emphasis": remarkCloseUnbalancedEmphasis,
  "normalize-mixed-emphasis": remarkNormalizeMixedEmphasis,
  "normalize-list-indentation": remarkNormalizeListIndentation,
  "merge-orphaned-list-fragments": remarkMergeOrphanedListFragments,
  "renumber-ordered-lists": remarkRenumberOrderedLists,
  "tighten-lists": remarkTightenLists,
  "normalize-blockquote-nesting": remarkNormalizeBlockquoteNesting,
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
