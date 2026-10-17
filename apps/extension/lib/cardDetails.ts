import type {
  CardPatchResponse,
  PatchCardPayload,
  SaveDetailsResponse,
  SaveErrorResponse,
} from "../types/messages";
import { isPatchCardPayload } from "./cardPatch";
import { oauthRequest } from "./oauthAuth";

/** The most library tags the popup reads for suggestions. */
const LIBRARY_TAG_LIMIT = 50;

interface Dependencies {
  request?: typeof oauthRequest;
}

const RATE_LIMITED_MESSAGE = "Too many requests. Try again in a moment";

const errorResult = async (response: Response): Promise<SaveErrorResponse> => {
  const body = (await response.json().catch(() => ({}))) as {
    code?: unknown;
    error?: unknown;
  };
  if (response.status === 429) {
    return {
      status: "error",
      code: "RATE_LIMITED",
      message: RATE_LIMITED_MESSAGE,
    };
  }
  return {
    status: "error",
    code: typeof body.code === "string" ? body.code : undefined,
    message:
      typeof body.error === "string"
        ? body.error
        : "Couldn't save your changes.",
  };
};

/**
 * Sends the popup's tags and note to the card. A request that never reached
 * Teak (a network error) is sent once more; PATCH replaces the same fields,
 * so a repeat is harmless.
 */
export async function patchCard(
  { cardId, notes, tags }: PatchCardPayload,
  { request = oauthRequest }: Dependencies = {}
): Promise<CardPatchResponse> {
  const send = () =>
    request(`/v1/cards/${encodeURIComponent(cardId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(tags === undefined ? {} : { tags }),
        ...(notes === undefined ? {} : { notes }),
      }),
    });
  let response: Response | null;
  try {
    response = await send();
  } catch {
    try {
      response = await send();
    } catch {
      return {
        status: "error",
        code: "NETWORK",
        message: "You're offline. Your changes weren't saved.",
      };
    }
  }
  if (!response) {
    return { status: "unauthenticated" };
  }
  return response.ok ? { status: "updated" } : errorResult(response);
}

const readTags = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((tag): tag is string => typeof tag === "string")
    : [];

/**
 * What the popup needs beside a saved card: the library's most used tags,
 * and for a card that was already saved, its own tags and note.
 */
export async function loadSaveDetails(
  { cardId, existing }: { cardId: string; existing: boolean },
  { request = oauthRequest }: Dependencies = {}
): Promise<SaveDetailsResponse> {
  try {
    const [tagsResponse, cardResponse] = await Promise.all([
      request("/v1/tags"),
      existing ? request(`/v1/cards/${encodeURIComponent(cardId)}`) : null,
    ]);
    if (!tagsResponse || (existing && !cardResponse)) {
      return { status: "unauthenticated" };
    }
    if (cardResponse && !cardResponse.ok) {
      return await errorResult(cardResponse);
    }
    const tagItems = tagsResponse.ok
      ? ((await tagsResponse.json()) as { items?: unknown }).items
      : [];
    const libraryTags = (Array.isArray(tagItems) ? tagItems : [])
      .filter(
        (item): item is { count: number; name: string } =>
          typeof item?.name === "string" && typeof item?.count === "number"
      )
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, LIBRARY_TAG_LIMIT)
      .map((item) => item.name);
    if (!cardResponse) {
      return { status: "ok", libraryTags };
    }
    const card = (await cardResponse.json()) as {
      notes?: unknown;
      tags?: unknown;
    };
    return {
      status: "ok",
      libraryTags,
      card: {
        notes: typeof card.notes === "string" ? card.notes : "",
        tags: readTags(card.tags),
      },
    };
  } catch {
    return {
      status: "error",
      code: "NETWORK",
      message: "Couldn't load this card's tags.",
    };
  }
}

/**
 * Runs one card's patches one after another, in the order they arrived, so
 * an older change sent from a closing popup never lands after a newer one.
 */
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

/**
 * Keeps the popup's latest unsaved change and sends it when the popup's port
 * disconnects (the popup closed). A draft that isn't a valid patch is dropped.
 */
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
