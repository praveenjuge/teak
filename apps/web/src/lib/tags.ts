import {
  MAX_TAG_NAME_LENGTH,
  TAG_OPERATION_STALL_MS,
  type TagOperationKind,
  type TagOperationStatus,
  tagKey,
} from "@teak/convex/shared/tags";
import { ConvexError } from "convex/values";

export { MAX_TAG_NAME_LENGTH, tagKey } from "@teak/convex/shared/tags";

export interface TagSummaryItem {
  count: number;
  name: string;
}

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

export const isTagOperationStalled = (
  operation: TagOperationView,
  now = Date.now()
) =>
  operation.status === "running" &&
  operation.updatedAt !== undefined &&
  now - operation.updatedAt > TAG_OPERATION_STALL_MS;

export const TAG_OPERATION_OVERLAY_MS = 2 * 60_000;

export const tagErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof ConvexError) {
    const message = (error.data as { message?: unknown } | undefined)?.message;
    if (typeof message === "string") {
      return message;
    }
  }
  return fallback;
};

export const tagErrorCode = (error: unknown): string | undefined => {
  if (error instanceof ConvexError) {
    const code = (error.data as { code?: unknown } | undefined)?.code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
};

const cardsLabel = (count: number) =>
  `${count.toLocaleString()} card${count === 1 ? "" : "s"}`;

export const tagOperationProgressLabel = (operation: TagOperationView) =>
  `${Math.min(operation.changed, operation.total).toLocaleString()} of ${cardsLabel(operation.total)}`;

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

export const tagOperationDescription = (operation: TagOperationView) => {
  if (operation.status === "completed") {
    return `${cardsLabel(operation.changed)} changed`;
  }
  if (operation.status === "failed") {
    return "Try again to change the rest.";
  }
  return `${tagOperationProgressLabel(operation)} changed`;
};

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
