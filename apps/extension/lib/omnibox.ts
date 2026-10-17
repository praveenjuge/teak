import {
  cardSiteHost,
  hostForDisplay,
} from "@teak/convex/shared/utils/urlHost";

/** Typing `teak` and Space or Tab in the address bar enters Teak mode. */
export const OMNIBOX_KEYWORD = "teak";
export const OMNIBOX_MIN_CHARS = 2;
export const OMNIBOX_RESULT_LIMIT = 5;
export const OMNIBOX_TITLE_LIMIT = 80;
/** Longer queries are cut before they're sent; the full text still searches on Enter. */
export const OMNIBOX_MAX_QUERY_LENGTH = 500;
/** After a 429, inputs inside this window keep the notice and send nothing. */
export const OMNIBOX_RATE_LIMIT_PAUSE_MS = 5000;

/** Chromium reads suggestion descriptions as XML; Firefox shows plain text. */
export type OmniboxFlavor = "chromium" | "firefox";

export interface OmniboxCard {
  appUrl: string;
  content?: string | null;
  metadataTitle?: string | null;
  sourceTitle?: string | null;
  sourceUrl?: string | null;
  type: string;
  url?: string | null;
}

export type OmniboxOutcome =
  | { kind: "short" }
  | { kind: "results"; cards: OmniboxCard[] }
  | { kind: "empty" }
  | { kind: "signedOut" }
  | { kind: "error" }
  | { kind: "rateLimited" };

export interface OmniboxSuggestion {
  content: string;
  description: string;
}

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

export const escapeOmniboxXml = (text: string): string =>
  text.replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char);

/** Cuts by code point so an emoji or surrogate pair is never split. */
export const truncateTitle = (
  text: string,
  limit = OMNIBOX_TITLE_LIMIT
): string => {
  const chars = Array.from(text);
  return chars.length > limit
    ? `${chars
        .slice(0, limit - 1)
        .join("")
        .trimEnd()}…`
    : text;
};

// Control characters would also break the XML Chromium parses.
const collapse = (value: string | null | undefined) =>
  (value ?? "").replace(/[\p{Cc}\s]+/gu, " ").trim();

const displayHost = (card: OmniboxCard) => {
  const host = cardSiteHost(card);
  return host ? hostForDisplay(host) : "";
};

/**
 * A card's page title, else its first words, else its site, else its type.
 * A link's content is its URL, so a link without a title shows its host.
 */
export const omniboxCardTitle = (card: OmniboxCard): string => {
  const content = collapse(card.content);
  return (
    collapse(card.metadataTitle) ||
    (content === card.url ? "" : content) ||
    collapse(card.sourceTitle) ||
    displayHost(card) ||
    `Untitled ${card.type}`
  );
};

export function buildSuggestions(
  cards: readonly OmniboxCard[],
  flavor: OmniboxFlavor
): OmniboxSuggestion[] {
  return cards.map((card) => {
    const title = truncateTitle(omniboxCardTitle(card));
    const host = displayHost(card);
    // A card named by its host doesn't repeat it.
    const details = [card.type, host === title ? "" : host]
      .filter(Boolean)
      .join(" · ");
    return {
      content: card.appUrl,
      description:
        flavor === "chromium"
          ? `${escapeOmniboxXml(title)} <dim>${escapeOmniboxXml(details)}</dim>`
          : `${title} — ${details}`,
    };
  });
}

/**
 * The default row, the one Enter on the typed text picks. `%s` is the
 * browser's placeholder for that text.
 */
export function defaultSuggestion(
  outcome: OmniboxOutcome,
  flavor: OmniboxFlavor
): string {
  const dim = (text: string) =>
    flavor === "chromium" ? ` <dim>${text}</dim>` : ` — ${text}`;
  const search =
    flavor === "chromium"
      ? "Search Teak for <match>%s</match>"
      : "Search Teak for %s";
  switch (outcome.kind) {
    case "signedOut":
      return "Sign in to Teak to search";
    case "empty":
      return `${search}${dim("No matching cards")}`;
    case "error":
      return `${search}${dim("Couldn't reach Teak")}`;
    case "rateLimited":
      return `${search}${dim("Too many searches, slow down")}`;
    default:
      return search;
  }
}

/**
 * Whether the session is still signed out after `outcome`. Only an answer
 * from Teak changes it: a short input or a paused search after a 429 says
 * nothing about the account.
 */
export function stillSignedOut(
  signedOut: boolean,
  outcome: OmniboxOutcome
): boolean {
  switch (outcome.kind) {
    case "signedOut":
      return true;
    case "results":
    case "empty":
    case "error":
      return false;
    default:
      return signedOut;
  }
}

/** The web app's search for `text`, or the library itself for no text. */
export const searchUrl = (appUrl: string, text: string): string => {
  const url = new URL("/", appUrl);
  if (text.trim()) {
    url.searchParams.set("q", text.trim());
  }
  return url.href;
};

/**
 * A suggestion's `appUrl`, if `text` is one: on the app's own origin and
 * naming a card. Anything else, a forged or typed URL included, is search
 * text.
 */
export function cardUrlFrom(text: string, appUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  const app = new URL(appUrl);
  const card = url.searchParams.get("card");
  return url.origin === app.origin &&
    url.pathname === "/" &&
    url.username === "" &&
    url.password === "" &&
    card &&
    /^[A-Za-z0-9_-]{1,128}$/.test(card)
    ? url.href
    : null;
}

interface Clock {
  clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
  now: () => number;
  setTimeout: (run: () => void, ms: number) => ReturnType<typeof setTimeout>;
}

const systemClock: Clock = {
  clearTimeout: (handle) => clearTimeout(handle),
  now: () => Date.now(),
  setTimeout: (run, ms) => setTimeout(run, ms),
};

/**
 * Sends the latest text once typing pauses for `debounceMs`, and at most once
 * every `minIntervalMs` while it doesn't, so steady typing still updates the
 * suggestions about once a second. Text equal to the last sent is skipped.
 */
export function createInputThrottle(
  { debounceMs, minIntervalMs }: { debounceMs: number; minIntervalMs: number },
  send: (text: string) => void,
  clock: Clock = systemClock
) {
  let pending: string | undefined;
  let pendingSince: number | undefined;
  let lastSent: string | undefined;
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const stop = () => {
    if (timer !== undefined) {
      clock.clearTimeout(timer);
      timer = undefined;
    }
  };
  const fire = () => {
    timer = undefined;
    const text = pending;
    pending = undefined;
    pendingSince = undefined;
    if (text === undefined || text === lastSent) {
      return;
    }
    lastSent = text;
    lastSentAt = clock.now();
    send(text);
  };

  return {
    input(text: string) {
      const now = clock.now();
      pending = text;
      pendingSince ??= now;
      stop();
      const due = Math.max(
        Math.min(now + debounceMs, pendingSince + minIntervalMs),
        lastSentAt + minIntervalMs
      );
      timer = clock.setTimeout(fire, Math.max(0, due - now));
    },
    /** Drops text waiting to be sent. */
    cancel() {
      stop();
      pending = undefined;
      pendingSince = undefined;
    },
    /** Drops waiting text and forgets what was sent, for a new session. */
    reset() {
      stop();
      pending = undefined;
      pendingSince = undefined;
      lastSent = undefined;
    },
    /** Lets `text` be sent again, as when its request was cancelled. */
    forget(text: string) {
      if (lastSent === text) {
        lastSent = undefined;
      }
    },
  };
}

/** Reads `GET /v1/cards` for the omnibox. `request` is `oauthRequest` in the background. */
export async function searchOmnibox(
  text: string,
  signal: AbortSignal,
  request: (path: string, init?: RequestInit) => Promise<Response | null>
): Promise<OmniboxOutcome> {
  const params = new URLSearchParams({
    include: "content",
    limit: String(OMNIBOX_RESULT_LIMIT),
    // Chromium drops an extension's suggestions that arrive about 1.5 s after
    // the last keystroke; ranking by meaning often takes longer, so the
    // suggestions match words. Enter opens the full search.
    mode: "keyword",
    q: Array.from(text.trim()).slice(0, OMNIBOX_MAX_QUERY_LENGTH).join(""),
  });
  let response: Response | null;
  try {
    response = await request(`/v1/cards?${params}`, { signal });
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    return { kind: "error" };
  }
  if (!response) {
    return { kind: "signedOut" };
  }
  if (response.status === 429) {
    return { kind: "rateLimited" };
  }
  if (!response.ok) {
    return { kind: "error" };
  }
  const body = (await response.json().catch(() => null)) as {
    items?: unknown;
  } | null;
  const items = Array.isArray(body?.items) ? body.items : null;
  if (!items) {
    return { kind: "error" };
  }
  const cards = items
    .filter(
      (item): item is OmniboxCard =>
        typeof item === "object" &&
        item !== null &&
        typeof item.appUrl === "string" &&
        typeof item.type === "string"
    )
    .slice(0, OMNIBOX_RESULT_LIMIT);
  return cards.length > 0 ? { kind: "results", cards } : { kind: "empty" };
}

/**
 * One address-bar session: throttles input, cancels a request when the text
 * moves on, shows only the latest text's answer, and reuses the answer for
 * text already searched.
 */
export function createOmniboxSearch({
  clock = systemClock,
  search,
  show,
}: {
  clock?: Clock;
  search: (text: string, signal: AbortSignal) => Promise<OmniboxOutcome>;
  show: (text: string, outcome: OmniboxOutcome) => void;
}) {
  let current = "";
  let inflight: { controller: AbortController; text: string } | undefined;
  let answered: { outcome: OmniboxOutcome; text: string } | undefined;
  let pausedUntil = Number.NEGATIVE_INFINITY;

  const abort = () => {
    if (!inflight) {
      return;
    }
    inflight.controller.abort();
    throttle.forget(inflight.text);
    inflight = undefined;
  };

  const throttle = createInputThrottle(
    { debounceMs: 400, minIntervalMs: 1000 },
    (text) => {
      abort();
      const controller = new AbortController();
      const request = { controller, text };
      inflight = request;
      search(text, controller.signal)
        .catch((): OmniboxOutcome | null =>
          controller.signal.aborted ? null : { kind: "error" }
        )
        .then((outcome) => {
          if (!outcome || inflight !== request) {
            return;
          }
          inflight = undefined;
          if (outcome.kind === "rateLimited") {
            pausedUntil = clock.now() + OMNIBOX_RATE_LIMIT_PAUSE_MS;
          }
          if (outcome.kind === "results" || outcome.kind === "empty") {
            answered = { outcome, text };
          } else {
            throttle.forget(text);
          }
          if (current === text) {
            show(text, outcome);
          }
        });
    },
    clock
  );

  return {
    input(raw: string) {
      const text = raw.trim();
      current = text;
      if (Array.from(text).length < OMNIBOX_MIN_CHARS) {
        throttle.cancel();
        abort();
        show(text, { kind: "short" });
        return;
      }
      if (clock.now() < pausedUntil) {
        throttle.cancel();
        show(text, { kind: "rateLimited" });
        return;
      }
      if (answered?.text === text) {
        throttle.cancel();
        if (inflight?.text !== text) {
          abort();
        }
        show(text, answered.outcome);
        return;
      }
      if (inflight?.text === text) {
        throttle.cancel();
        return;
      }
      if (inflight) {
        abort();
      }
      throttle.input(text);
    },
    /** Ends the session: nothing waits, nothing is in flight, nothing is kept. */
    reset() {
      throttle.reset();
      abort();
      current = "";
      answered = undefined;
    },
  };
}
