import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import type { TeakTranslator } from "@teak/i18n";
import { useTranslations } from "@teak/i18n/react";
import { useMutation } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { UNDO_TOAST_DURATION_MS } from "@/constants/toast";
import { clipFolderName } from "@/lib/clipFolderName";
import { useQuery } from "@/lib/convexQueryHooks";
import { useServerErrors } from "./useServerErrors";

interface FollowedRun {
  folderId: Id<"folders">;
  name: string;
  runId: Id<"folderRuleRuns">;
}

const toastId = (runId: string) => `folder-rule-run-${runId}`;

/** What a run did, leaving out the half it didn't do. */
const doneMessage = (
  t: TeakTranslator<"folders.ruleRun">,
  filed: number,
  tagged: number,
  name: string
) => {
  if (filed > 0 && tagged > 0) {
    return t("done", { filed, tagged, name });
  }
  return filed > 0
    ? t("doneFiled", { filed, name })
    : t("doneTagged", { tagged, name });
};

/**
 * Follows a folder rule run once its rules are saved: a toast while it runs,
 * then what it filed and tagged, with Undo. Undo shows its own progress.
 */
export function useFolderRuleRunToast() {
  const t = useTranslations("folders.ruleRun");
  const tc = useTranslations("common");
  const errors = useServerErrors();
  const [followed, setFollowed] = useState<FollowedRun | null>(null);
  const run = useQuery(
    api.folders.getFolderRuleRun,
    followed ? { folderId: followed.folderId, runId: followed.runId } : "skip"
  );
  const undoRun = useMutation(api.folders.undoFolderRuleRun);
  const settled = useRef(new Set<string>());

  const follow = useCallback((next: FollowedRun) => setFollowed(next), []);

  useEffect(() => {
    if (!(followed && run) || run._id !== followed.runId) {
      return;
    }
    const id = toastId(run._id);
    const name = clipFolderName(followed.name);
    if (run.status === "running") {
      toast.loading(t("running", { name }), { id });
      return;
    }
    if (run.status === "undoing") {
      toast.loading(t("undoing", { name }), { id });
      return;
    }
    const key = `${run._id}:${run.status}`;
    if (settled.current.has(key)) {
      return;
    }
    settled.current.add(key);
    if (run.status === "undone") {
      toast.success(t("undone", { name }), { id });
      return;
    }
    if (run.status === "superseded") {
      toast.dismiss(id);
      return;
    }
    if (run.filedCount + run.taggedCount === 0) {
      toast.success(t("nothing", { name }), { id });
      return;
    }
    toast.success(doneMessage(t, run.filedCount, run.taggedCount, name), {
      id,
      duration: UNDO_TOAST_DURATION_MS,
      action: run.canUndo
        ? {
            label: tc("undo"),
            onClick: () => {
              undoRun({ folderId: followed.folderId, runId: run._id }).catch(
                (error) => toast.error(errors.message(error, t("undoFailed")))
              );
            },
          }
        : undefined,
    });
  }, [errors, followed, run, t, tc, undoRun]);

  return follow;
}
