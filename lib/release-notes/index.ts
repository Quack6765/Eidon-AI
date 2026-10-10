import { releaseNote as v4_0_1 } from "@/lib/release-notes/v4.0.1";
import { releaseNote as v4_1_0 } from "@/lib/release-notes/v4.1.0";
import { releaseNote as v5_0_0 } from "@/lib/release-notes/v5.0.0";
import { releaseNote as v5_1_0 } from "@/lib/release-notes/v5.1.0";
import { releaseNote as v5_1_3 } from "@/lib/release-notes/v5.1.3";
import type { ReleaseHighlight } from "@/lib/release-notes/types";

export type { ReleaseHighlight };

export const RELEASE_NOTES: ReleaseHighlight[] = [v4_0_1, v4_1_0, v5_0_0, v5_1_0, v5_1_3];
