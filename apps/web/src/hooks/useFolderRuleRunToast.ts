import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
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
    // Sonner merges an update into the toast with the same id, so clear the
    // done toast's Undo and duration instead of carrying them over.
    const update = { id, action: undefined, duration: undefined };
    const name = clipFolderName(followed.name);
    if (run.status === "running") {
      toast.loading(t("running", { name }), update);
      return;
    }
    if (run.status === "undoing") {
      toast.loading(t("undoing", { name }), update);
      return;
    }
    const key = `${run._id}:${run.status}`;
    if (settled.current.has(key)) {
      return;
    }
    settled.current.add(key);
    if (run.status === "undone") {
      toast.success(t("undone", { name }), update);
      return;
    }
    if (run.status === "superseded") {
      toast.dismiss(id);
      return;
    }
    if (run.changedCount === 0) {
      toast.success(t("nothing", { name }), update);
      return;
    }
    toast.success(t("done", { count: run.changedCount, name }), {
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
