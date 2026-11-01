import {
  MAX_TAG_NAME_LENGTH,
  TAG_OPERATION_STALL_MS,
  type TagOperationKind,
  type TagOperationStatus,
  tagKey,
} from "@teak/convex/shared/tags";
import type { TeakTranslator } from "@teak/i18n";
import { ConvexError } from "convex/values";
import { englishErrors, englishTranslator } from "./englishTranslators";
import {
  type ErrorsTranslator,
  translateErrorKey,
  translateServerMessage,
} from "./serverErrors";

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

export type TagsTranslator = TeakTranslator<"lib.tags">;

const englishTags: TagsTranslator = englishTranslator("lib.tags");

export const tagErrorMessage = (
  error: unknown,
  fallback: string,
  t: ErrorsTranslator = englishErrors
) => {
  if (error instanceof ConvexError) {
    const message = (error.data as { message?: unknown } | undefined)?.message;
    if (typeof message === "string") {
      return translateServerMessage(t, message);
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

export const tagOperationProgressLabel = (
  operation: TagOperationView,
  t: TagsTranslator = englishTags
) =>
  t("progress", {
    changed: Math.min(operation.changed, operation.total),
    total: operation.total,
  });

export const tagOperationTitle = (
  operation: TagOperationView,
  t: TagsTranslator = englishTags
) => {
  const values = { from: operation.from, to: operation.to ?? "" };
  if (operation.status === "completed") {
    return t(`completed.${operation.kind}`, values);
  }
  if (operation.status === "failed") {
    return t(`failed.${operation.kind}`, {
      changed: Math.min(operation.changed, operation.total),
      total: operation.total,
    });
  }
  return t(`running.${operation.kind}`, values);
};

export const tagOperationDescription = (
  operation: TagOperationView,
  t: TagsTranslator = englishTags
) => {
  if (operation.status === "completed") {
    return t("changedDescription", { count: operation.changed });
  }
  if (operation.status === "failed") {
    return t("failedDescription");
  }
  return t("runningDescription", {
    changed: Math.min(operation.changed, operation.total),
    total: operation.total,
  });
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

export const explainTagNameInput = (
  name: string,
  t: ErrorsTranslator = englishErrors
): string | null => {
  const trimmed = name.trim();
  if (!trimmed) {
    return translateErrorKey(t, "tags.EMPTY_NAME");
  }
  if (trimmed.length > MAX_TAG_NAME_LENGTH) {
    return translateErrorKey(t, "tags.NAME_TOO_LONG");
  }
  return null;
};
