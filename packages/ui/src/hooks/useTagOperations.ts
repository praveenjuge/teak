import { api } from "@teak/convex";
import type { TagOperationKind } from "@teak/convex/shared/tags";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  isTagOperationStalled,
  TAG_OPERATION_OVERLAY_MS,
  type TagOperationView,
  tagErrorCode,
  tagErrorMessage,
  tagOperationDescription,
  tagOperationTitle,
} from "../lib/tags";
import { useNow } from "./useNow";

export interface StartTagOperationInput {
  from: string;
  kind: TagOperationKind;
  to?: string;
}

export interface UseTagOperationsResult {
  latest: TagOperationView | null | undefined;
  operation: TagOperationView | null | undefined;
  start: (input: StartTagOperationInput) => Promise<TagOperationView>;
}

const toastId = (operationId: string) => `tag-operation-${operationId}`;

const asStalled = <T extends TagOperationView | null | undefined>(
  operation: T,
  now: number
): T =>
  operation && isTagOperationStalled(operation, now)
    ? { ...operation, status: "failed" as const }
    : operation;

export function useTagOperations(): UseTagOperationsResult {
  const startMutation = useMutation(api.tags.startTagOperation);
  const latest: TagOperationView | null | undefined = useQuery(
    api.tags.getLatestTagOperation,
    {}
  );
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
  const settledRef = useRef(new Set<string>());

  const start = useCallback(
    async (input: StartTagOperationInput) => {
      const started = await startMutation(input);
      setFollowedId(started._id);
      return started;
    },
    [startMutation]
  );

  const retry = useCallback(
    async (operation: TagOperationView) => {
      const input = {
        kind: operation.kind,
        from: operation.from,
        ...(operation.to === undefined ? {} : { to: operation.to }),
      };
      try {
        return await start(input);
      } catch (error) {
        if (
          operation.kind === "rename" &&
          tagErrorCode(error) === "TAG_EXISTS"
        ) {
          return await start({ ...input, kind: "merge" });
        }
        throw error;
      }
    },
    [start]
  );

  const isRunning =
    operation?.status === "running" || latest?.status === "running";
  const overlayEndsAt =
    latest?.status === "completed" && latest.completedAt !== undefined
      ? latest.completedAt + TAG_OPERATION_OVERLAY_MS
      : undefined;
  const now = useNow({
    every: isRunning ? 15_000 : undefined,
    until: [overlayEndsAt],
  });
  const shown = useMemo(() => asStalled(operation, now), [now, operation]);
  const shownLatest = useMemo(
    () =>
      overlayEndsAt !== undefined && now > overlayEndsAt
        ? null
        : asStalled(latest, now),
    [latest, now, overlayEndsAt]
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
          retry(operation).catch((error) =>
            toast.error(tagErrorMessage(error, "Couldn't start the tag change"))
          );
        },
      },
    });
  }, [retry, shown]);

  return { latest: shownLatest, operation: shown, start };
}
