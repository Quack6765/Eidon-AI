import { releaseNote as v4_0_1 } from "@/lib/release-notes/v4.0.1";
import { releaseNote as v4_1_0 } from "@/lib/release-notes/v4.1.0";
import type { ReleaseHighlight } from "@/lib/release-notes/types";

export type { ReleaseHighlight };

export const RELEASE_NOTES: ReleaseHighlight[] = [v4_0_1, v4_1_0];
