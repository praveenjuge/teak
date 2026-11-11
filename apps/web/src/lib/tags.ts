import {
  MAX_TAG_NAME_LENGTH,
  TAG_OPERATION_STALL_MS,
  tagKey,
} from "@teak/convex/shared/tags";
import type { tagOperationReturnValidator } from "@teak/convex/tag/tagOperations";
import type { tagSummaryItemValidator } from "@teak/convex/tag/tagSummary";
import type { TeakTranslator } from "@teak/i18n";
import type { Infer } from "convex/values";
import { type ErrorsTranslator, translateErrorKey } from "./serverErrors";

// The return shapes come from the functions' `returns` validators, since the
// generated `api` types every function as `any` and FunctionReturnType can't.
export type TagSummaryItem = Infer<typeof tagSummaryItemValidator>;

export const tagDisplayName = (item: Pick<TagSummaryItem, "label" | "name">) =>
  item.label ?? item.name;

export type TagOperationView = Infer<typeof tagOperationReturnValidator>;

export const isTagOperationStalled = (
  operation: TagOperationView,
  now = Date.now()
) =>
  operation.status === "running" &&
  operation.updatedAt !== undefined &&
  now - operation.updatedAt > TAG_OPERATION_STALL_MS;

export const TAG_OPERATION_OVERLAY_MS = 2 * 60_000;

export type TagsTranslator = TeakTranslator<"lib.tags">;

export const tagOperationTitle = (
  operation: TagOperationView,
  t: TagsTranslator
) => {
  // Tags shows a renamed or merged tag as it was typed, so the toast does too.
  const values = { from: operation.from, to: (operation.to ?? "").trim() };
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
  t: TagsTranslator
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
  const label = operation.to.trim();
  if (toKey === fromKey) {
    // A rename that only changes the case keeps the tag and its new casing.
    return items.map((item) =>
      item.name === fromKey && operation.kind === "rename"
        ? { ...item, label }
        : item
    );
  }
  const target = rest.find((item) => item.name === toKey);
  const merged = target
    ? rest.map((item) =>
        item.name === toKey
          ? { ...item, count: item.count + source.count }
          : item
      )
    : [...rest, { name: toKey, count: source.count, label }];
  return merged.sort((left, right) =>
    left.count === right.count
      ? left.name.localeCompare(right.name)
      : right.count - left.count
  );
};

export const explainTagNameInput = (
  name: string,
  t: ErrorsTranslator
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

export const TAGS_QUERY_PARAM = "q";

/**
 * The Tags page's URL with its Find a tag text as `q`, or without `q` when
 * the box is empty, so a reload or a shared link keeps the filter.
 */
export const tagsPageUrl = (href: string, query: string): string => {
  const url = new URL(href);
  if (query.trim()) {
    url.searchParams.set(TAGS_QUERY_PARAM, query);
  } else {
    url.searchParams.delete(TAGS_QUERY_PARAM);
  }
  return `${url.pathname}${url.search}${url.hash}`;
};
