import { tagKey } from "@teak/convex/shared/tags";
import { useCallback, useEffect, useRef } from "react";
import {
  type CardPatchResponse,
  type PatchCardPayload,
  SAVE_DETAILS_PORT,
  type SaveDetailsDraftMessage,
} from "../../types/messages";

export interface CardFields {
  notes: string;
  tags: string[];
}

interface Snapshots {
  confirmed: CardFields;
  current: CardFields;
  sent: CardFields;
}

const EMPTY: CardFields = { notes: "", tags: [] };

const sameTags = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((tag, index) => tag === b[index]);

export const changeBetween = (
  cardId: string,
  next: CardFields,
  base: CardFields
): PatchCardPayload | null => {
  const change: PatchCardPayload = { cardId };
  if (!sameTags(next.tags, base.tags)) {
    change.tags = next.tags;
    const before = new Set(base.tags.map(tagKey));
    const addedTags = next.tags.filter((tag) => !before.has(tagKey(tag)));
    if (addedTags.length > 0) {
      change.addedTags = addedTags;
    }
  }
  if (next.notes !== base.notes) {
    change.notes = next.notes;
  }
  return change.tags === undefined && change.notes === undefined
    ? null
    : change;
};

export const confirmChange = (
  confirmed: CardFields,
  change: PatchCardPayload
): CardFields => ({
  notes: change.notes ?? confirmed.notes,
  tags: change.tags ?? confirmed.tags,
});

export const unsendFailedChange = (
  sent: CardFields,
  change: PatchCardPayload,
  before: CardFields
): CardFields => ({
  notes:
    change.notes !== undefined && sent.notes === change.notes
      ? before.notes
      : sent.notes,
  tags:
    change.tags !== undefined && sent.tags === change.tags
      ? before.tags
      : sent.tags,
});

export function useDraftSync({
  cardId,
  ready,
  sendPatch,
}: {
  cardId: string;
  ready: boolean;
  sendPatch: (payload: PatchCardPayload) => Promise<CardPatchResponse>;
}) {
  const snapshots = useRef<Snapshots>({
    confirmed: EMPTY,
    current: EMPTY,
    sent: EMPTY,
  });
  const port = useRef<chrome.runtime.Port>(undefined);

  useEffect(() => {
    const connection = chrome.runtime.connect({ name: SAVE_DETAILS_PORT });
    port.current = connection;
    return () => {
      port.current = undefined;
      connection.disconnect();
    };
  }, []);

  const changeSince = useCallback(
    (base: CardFields) =>
      ready ? changeBetween(cardId, snapshots.current.current, base) : null,
    [cardId, ready]
  );

  const postDraft = useCallback(() => {
    const message: SaveDetailsDraftMessage = {
      draft: changeSince(snapshots.current.confirmed),
    };
    try {
      port.current?.postMessage(message);
    } catch {}
  }, [changeSince]);

  const load = useCallback((card: CardFields) => {
    snapshots.current = { confirmed: card, current: card, sent: card };
  }, []);

  const edit = useCallback(
    (fields: Partial<CardFields>) => {
      snapshots.current = {
        ...snapshots.current,
        current: { ...snapshots.current.current, ...fields },
      };
      postDraft();
    },
    [postDraft]
  );

  const send = useCallback((): {
    change: PatchCardPayload;
    result: Promise<CardPatchResponse>;
  } | null => {
    const change = changeSince(snapshots.current.sent);
    if (!change) {
      return null;
    }
    const before = snapshots.current.sent;
    snapshots.current = {
      ...snapshots.current,
      sent: { ...snapshots.current.current },
    };
    postDraft();
    const result = sendPatch(change).then((response) => {
      snapshots.current =
        response.status === "updated"
          ? {
              ...snapshots.current,
              confirmed: confirmChange(snapshots.current.confirmed, change),
            }
          : {
              ...snapshots.current,
              sent: unsendFailedChange(snapshots.current.sent, change, before),
            };
      postDraft();
      return response;
    });
    return { change, result };
  }, [changeSince, postDraft, sendPatch]);

  return { edit, load, send };
}
