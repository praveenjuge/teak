import type {
  CardPatchResponse,
  PatchCardPayload,
  SaveDetailsResponse,
  SaveErrorResponse,
} from "../types/messages";
import { isPatchCardPayload } from "./cardPatch";
import { oauthRequest } from "./oauthAuth";

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

const retryOnceOnNetworkError = <T>(send: () => Promise<T>): Promise<T> =>
  send().catch(send);

export async function patchCard(
  { cardId, notes, tags }: PatchCardPayload,
  { request = oauthRequest }: Dependencies = {}
): Promise<CardPatchResponse> {
  const sendIdempotentPatch = () =>
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
    response = await retryOnceOnNetworkError(sendIdempotentPatch);
  } catch {
    return {
      status: "error",
      code: "NETWORK",
      message: "You're offline. Your changes weren't saved.",
    };
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

export async function loadSaveDetails(
  { alreadySaved, cardId }: { alreadySaved: boolean; cardId: string },
  { request = oauthRequest }: Dependencies = {}
): Promise<SaveDetailsResponse> {
  try {
    const [tagsResponse, cardResponse] = await Promise.all([
      request("/v1/tags"),
      alreadySaved ? request(`/v1/cards/${encodeURIComponent(cardId)}`) : null,
    ]);
    if (!tagsResponse || (alreadySaved && !cardResponse)) {
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
