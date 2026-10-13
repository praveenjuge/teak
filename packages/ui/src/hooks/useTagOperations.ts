import { api } from "@teak/convex";
import type { TagOperationKind } from "@teak/convex/shared/tags";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  isTagOperationStalled,
  type TagOperationView,
  tagErrorMessage,
  tagOperationDescription,
  tagOperationTitle,
} from "../lib/tags";

export interface StartTagOperationInput {
  from: string;
  kind: TagOperationKind;
  to?: string;
}

export interface UseTagOperationsResult {
  /**
   * The latest change, running or finished, so the tag list can show it
   * before the background counts catch up.
   */
  latest: TagOperationView | null | undefined;
  /** The change being followed: the one this tab started or one running. */
  operation: TagOperationView | null | undefined;
  /** Starts a change and follows it in one progress toast. Throws on refusal. */
  start: (input: StartTagOperationInput) => Promise<TagOperationView>;
}

const toastId = (operationId: string) => `tag-operation-${operationId}`;

/**
 * Library-wide tag changes: starting one, and a single toast that tracks it
 * until it finishes. A change already running (after a reload, or from
 * another tab) is picked up and followed too.
 */
export function useTagOperations(): UseTagOperationsResult {
  const startMutation = useMutation(api.tags.startTagOperation);
  const latest: TagOperationView | null | undefined = useQuery(
    api.tags.getLatestTagOperation,
    {}
  );
  // The last change this tab started or saw running (from another tab, or
  // before a reload). It stays followed after it finishes, so its toast
  // shows the result instead of spinning forever.
  const [followedId, setFollowedId] = useState<string | null>(null);
  const runningId = latest?.status === "running" ? latest._id : undefined;
  useEffect(() => {
    if (runningId) {
      setFollowedId(runningId);
    }
  }, [runningId]);
  const operation: TagOperationView | null | undefined = useQuery(
    api.tags.getTagOperation,
    followedId ? { operationId: followedId } : "skip"
  );
  // A finished change shows its result once, even if the query re-renders.
  const settledRef = useRef(new Set<string>());

  const start = useCallback(
    async (input: StartTagOperationInput) => {
      const started = await startMutation(input);
      setFollowedId(started._id);
      return started;
    },
    [startMutation]
  );

  // A change that stops making progress (a lost batch) turns into a failure
  // with Retry instead of a spinner that never ends.
  const [now, setNow] = useState(() => Date.now());
  const isRunning = operation?.status === "running";
  useEffect(() => {
    if (!isRunning) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [isRunning]);
  const shown = useMemo(
    () =>
      operation && isTagOperationStalled(operation, now)
        ? { ...operation, status: "failed" as const }
        : operation,
    [now, operation]
  );

  useEffect(() => {
    if (!shown || settledRef.current.has(shown._id)) {
      return;
    }
    const operation = shown;
    const id = toastId(operation._id);
    const title = tagOperationTitle(operation);
    const description = tagOperationDescription(operation);
    if (operation.status === "running") {
      toast.loading(title, { id, description });
      return;
    }
    settledRef.current.add(operation._id);
    if (operation.status === "completed") {
      toast.success(title, { id, description });
      return;
    }
    toast.error(title, {
      id,
      description,
      duration: 10_000,
      action: {
        label: "Retry",
        onClick: () => {
          start({
            kind: operation.kind,
            from: operation.from,
            ...(operation.to === undefined ? {} : { to: operation.to }),
          }).catch((error) =>
            toast.error(tagErrorMessage(error, "Couldn't start the tag change"))
          );
        },
      },
    });
  }, [shown, start]);

  return { latest, operation: shown, start };
}
