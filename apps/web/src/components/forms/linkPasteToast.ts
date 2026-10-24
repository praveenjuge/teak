import type { api } from "@teak/convex";
import {
  FREE_TIER_LIMIT,
  LINK_PASTE_LIMIT,
} from "@teak/convex/shared/constants";
import type { TeakTranslator } from "@teak/i18n";
import type { FunctionReturnType } from "convex/server";

export type LinkPasteProgress = NonNullable<
  FunctionReturnType<typeof api.card.pasteLinks.getLinkPaste>
>;

export interface LinkPasteToast {
  /** `loading` while it runs; `limit` gets the Upgrade action. */
  kind: "loading" | "success" | "limit" | "error";
  message: string;
}

/**
 * What the composer's toast says about a pasted list of links: progress while
 * the job runs, then how it ended. `extraOmitted` counts lines the composer
 * never sent, on top of those the server left out past 100.
 */
export function linkPasteToast(
  progress: LinkPasteProgress,
  extraOmitted: number,
  t: TeakTranslator<"forms.pasteLinks">
): LinkPasteToast {
  switch (progress.status) {
    case "running":
      return {
        kind: "loading",
        message: t("progress", {
          done: progress.processed,
          total: progress.total,
        }),
      };
    case "stopped_at_limit":
      return {
        kind: "limit",
        message: t("stoppedAtLimit", {
          saved: progress.created + progress.resaved,
          total: progress.total,
          limit: FREE_TIER_LIMIT,
        }),
      };
    case "failed":
      return { kind: "error", message: t("failed") };
    default:
      return {
        kind: "success",
        message: t("saved", {
          created: progress.created,
          resaved: progress.resaved,
          failed: progress.failed,
          omitted: progress.omittedOverLimit + extraOmitted,
          limit: LINK_PASTE_LIMIT,
        }),
      };
  }
}
