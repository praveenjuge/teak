import {
  MAX_TAG_NAME_LENGTH,
  TAG_OPERATION_STALL_MS,
  type TagOperationKind,
  type TagOperationStatus,
  tagKey,
} from "@teak/convex/shared/tags";
import { ConvexError } from "convex/values";

export { MAX_TAG_NAME_LENGTH, tagKey } from "@teak/convex/shared/tags";

/** A tag in the tag list: its lowercase name and active card count. */
export interface TagSummaryItem {
  count: number;
  name: string;
}

/** A library-wide tag change as the app reads it. */
export interface TagOperationView {
  _id: string;
  changed: number;
  completedAt?: number;
  from: string;
  kind: TagOperationKind;
  processed: number;
  status: TagOperationStatus;
  to?: string;
  total: number;
  updatedAt?: number;
}

/**
 * A running change that has made no progress for a while has stopped (a lost
 * batch); the app shows it as failed so it can be retried.
 */
export const isTagOperationStalled = (
  operation: TagOperationView,
  now = Date.now()
) =>
  operation.status === "running" &&
  operation.updatedAt !== undefined &&
  now - operation.updatedAt > TAG_OPERATION_STALL_MS;

/**
 * How long a finished change keeps adjusting the tag list while the
 * background tag counts catch up.
 */
export const TAG_OPERATION_OVERLAY_MS = 2 * 60_000;

/** The server's message for a failed tag call, or the fallback. */
export const tagErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof ConvexError) {
    const message = (error.data as { message?: unknown } | undefined)?.message;
    if (typeof message === "string") {
      return message;
    }
  }
  return fallback;
};

/** The error code of a failed tag call, such as `TAG_EXISTS`. */
export const tagErrorCode = (error: unknown): string | undefined => {
  if (error instanceof ConvexError) {
    const code = (error.data as { code?: unknown } | undefined)?.code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
};

const cardsLabel = (count: number) =>
  `${count.toLocaleString()} card${count === 1 ? "" : "s"}`;

/** "120 of 300 cards", the progress a toast shows. */
export const tagOperationProgressLabel = (operation: TagOperationView) =>
  `${Math.min(operation.changed, operation.total).toLocaleString()} of ${cardsLabel(operation.total)}`;

/** The toast title for a tag change in each state. */
export const tagOperationTitle = (operation: TagOperationView) => {
  const to = operation.to ?? "";
  const { from } = operation;
  if (operation.status === "completed") {
    return {
      rename: `Renamed “${from}” to “${to}”`,
      merge: `Merged “${from}” into “${to}”`,
      delete: `Deleted “${from}”`,
    }[operation.kind];
  }
  if (operation.status === "failed") {
    const verb = { rename: "renaming", merge: "merging", delete: "deleting" }[
      operation.kind
    ];
    return `Couldn't finish ${verb}. ${tagOperationProgressLabel(operation)} changed.`;
  }
  return {
    rename: `Renaming “${from}” to “${to}”…`,
    merge: `Merging “${from}” into “${to}”…`,
    delete: `Deleting “${from}”…`,
  }[operation.kind];
};

/** The toast line under the title: progress, or how many cards changed. */
export const tagOperationDescription = (operation: TagOperationView) => {
  if (operation.status === "completed") {
    return `${cardsLabel(operation.changed)} changed`;
  }
  if (operation.status === "failed") {
    return "Try again to change the rest.";
  }
  return `${tagOperationProgressLabel(operation)} changed`;
};

/**
 * The tag list as it will look once a tag change lands: the background
 * counts take a few seconds to follow, so a running or just-finished change
 * is applied on top. Rename and merge move the count to the target (a card
 * with both is counted twice until the counts refresh); delete drops the tag.
 * A failed or stalled change shows the counts as they are.
 */
export const applyTagOperationToSummary = (
  items: readonly TagSummaryItem[],
  operation: TagOperationView | null | undefined,
  now = Date.now()
): TagSummaryItem[] => {
  if (
    !operation ||
    operation.status === "failed" ||
    isTagOperationStalled(operation, now) ||
    (operation.status === "completed" &&
      now - (operation.completedAt ?? 0) > TAG_OPERATION_OVERLAY_MS)
  ) {
    return [...items];
  }
  const fromKey = tagKey(operation.from);
  const source = items.find((item) => item.name === fromKey);
  if (!source) {
    return [...items];
  }
  const rest = items.filter((item) => item.name !== fromKey);
  if (operation.kind === "delete" || operation.to === undefined) {
    return rest;
  }
  const toKey = tagKey(operation.to);
  if (toKey === fromKey) {
    return [...items];
  }
  const target = rest.find((item) => item.name === toKey);
  const merged = target
    ? rest.map((item) =>
        item.name === toKey
          ? { ...item, count: item.count + source.count }
          : item
      )
    : [...rest, { name: toKey, count: source.count }];
  return merged.sort((left, right) =>
    left.count === right.count
      ? left.name.localeCompare(right.name)
      : right.count - left.count
  );
};

/** Why a new tag name is refused before asking the server, or null. */
export const explainTagNameInput = (name: string): string | null => {
  const trimmed = name.trim();
  if (!trimmed) {
    return "Name the tag";
  }
  if (trimmed.length > MAX_TAG_NAME_LENGTH) {
    return `Tags can be at most ${MAX_TAG_NAME_LENGTH} characters`;
  }
  return null;
};
