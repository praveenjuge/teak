import { TeakApiError, type TeakClient } from "teak-sdk";
import type {
  CardPatchResponse,
  PatchCardPayload,
  SaveDetailsResponse,
  SaveErrorResponse,
} from "../types/messages";
import { isPatchCardPayload } from "./cardPatch";
import { isSignedOut, teakClient } from "./oauthAuth";

const LIBRARY_TAG_LIMIT = 50;

interface Dependencies {
  client?: TeakClient;
}

const RATE_LIMITED_MESSAGE = "Too many requests. Try again in a moment";

/** A failed request as the save details panel shows it. */
const failure = (
  error: unknown,
  offline: string,
  fallback: string
): SaveErrorResponse | { status: "unauthenticated" } => {
  if (isSignedOut(error)) {
    return { status: "unauthenticated" };
  }
  if (!(error instanceof TeakApiError) || error.kind === "network") {
    return { status: "error", code: "NETWORK", message: offline };
  }
  if (error.kind === "rate_limited") {
    return {
      status: "error",
      code: "RATE_LIMITED",
      message: RATE_LIMITED_MESSAGE,
    };
  }
  return {
    status: "error",
    code: error.code,
    message: error.message || fallback,
  };
};

export async function patchCard(
  { cardId, notes, tags }: PatchCardPayload,
  { client = teakClient() }: Dependencies = {}
): Promise<CardPatchResponse> {
  try {
    await client.cards.update(cardId, {
      ...(tags === undefined ? {} : { tags }),
      ...(notes === undefined ? {} : { notes }),
    });
    return { status: "updated" };
  } catch (error) {
    return failure(
      error,
      "You're offline. Your changes weren't saved.",
      "Couldn't save your changes."
    );
  }
}

export async function loadSaveDetails(
  { alreadySaved, cardId }: { alreadySaved: boolean; cardId: string },
  { client = teakClient() }: Dependencies = {}
): Promise<SaveDetailsResponse> {
  try {
    const [tags, card] = await Promise.all([
      client.tags.list().catch((error: unknown) => {
        // The library's tags are a convenience; the card's own are not.
        if (isSignedOut(error)) {
          throw error;
        }
        return { items: [] };
      }),
      alreadySaved ? client.cards.get(cardId) : null,
    ]);
    const libraryTags = [...tags.items]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, LIBRARY_TAG_LIMIT)
      .map((item) => item.name);
    return card
      ? {
          status: "ok",
          libraryTags,
          card: { notes: card.notes ?? "", tags: card.tags },
        }
      : { status: "ok", libraryTags };
  } catch (error) {
    return failure(
      error,
      "Couldn't load this card's tags.",
      "Couldn't load this card's tags."
    );
  }
}

export function createPatchQueue(send: typeof patchCard = patchCard) {
  const tails = new Map<string, Promise<unknown>>();
  return (payload: PatchCardPayload): Promise<CardPatchResponse> => {
    const run = (tails.get(payload.cardId) ?? Promise.resolve()).then(() =>
      send(payload)
    );
    const tail = run.catch(() => undefined);
    tails.set(payload.cardId, tail);
    void tail.then(() => {
      if (tails.get(payload.cardId) === tail) {
        tails.delete(payload.cardId);
      }
    });
    return run;
  };
}

export function createDraftKeeper(
  send: (payload: PatchCardPayload) => Promise<CardPatchResponse>
) {
  let draft: PatchCardPayload | null = null;
  return {
    update(message: unknown) {
      const value = (message as { draft?: unknown } | null)?.draft;
      draft = isPatchCardPayload(value) ? value : null;
    },
    flush(): Promise<CardPatchResponse | null> {
      const pending = draft;
      draft = null;
      return pending ? send(pending) : Promise.resolve(null);
    },
  };
}
