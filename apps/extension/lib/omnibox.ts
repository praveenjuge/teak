import { truncateCodePoints } from "@teak/convex/shared/utils/codePoints";
import {
  cardSiteHost,
  hostForDisplay,
} from "@teak/convex/shared/utils/urlHost";
import type { TeakTranslator } from "@teak/i18n";

export const OMNIBOX_KEYWORD = "teak";
export const OMNIBOX_MIN_CHARS = 2;
export const OMNIBOX_RESULT_LIMIT = 5;
export const OMNIBOX_TITLE_LIMIT = 80;
export const OMNIBOX_MAX_QUERY_LENGTH = 500;
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

export type OmniboxStrings = TeakTranslator<"extension.omnibox">;

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

export const escapeOmniboxXml = (text: string): string =>
  text.replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char);

// Catalog text sits between Chromium's tags; quotes are fine there.
const escapeXmlText = (text: string): string =>
  text.replace(/[&<>]/g, (char) => XML_ESCAPES[char] ?? char);

export const truncateTitle = (
  text: string,
  limit = OMNIBOX_TITLE_LIMIT
): string =>
  truncateCodePoints(text, limit) === text
    ? text
    : `${truncateCodePoints(text, limit - 1).trimEnd()}…`;

// Control characters would also break the XML Chromium parses.
const collapse = (value: string | null | undefined) =>
  (value ?? "").replace(/[\p{Cc}\s]+/gu, " ").trim();

const displayHost = (card: OmniboxCard) => {
  const host = cardSiteHost(card);
  return host ? hostForDisplay(host) : "";
};

export const omniboxCardTitle = (
  card: OmniboxCard,
  t: OmniboxStrings
): string => {
  const content = collapse(card.content);
  return (
    collapse(card.metadataTitle) ||
    (content === card.url ? "" : content) ||
    collapse(card.sourceTitle) ||
    displayHost(card) ||
    t("untitled", { type: card.type })
  );
};

export function buildSuggestions(
  cards: readonly OmniboxCard[],
  flavor: OmniboxFlavor,
  t: OmniboxStrings
): OmniboxSuggestion[] {
  return cards.map((card) => {
    const title = truncateTitle(omniboxCardTitle(card, t));
    const host = displayHost(card);
    const details = [
      t("cardType", { type: card.type }),
      host === title ? "" : host,
    ]
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

const NOTICES: Partial<
  Record<OmniboxOutcome["kind"], "noMatches" | "rateLimited" | "unreachable">
> = {
  empty: "noMatches",
  error: "unreachable",
  rateLimited: "rateLimited",
};

const noticeFor = (outcome: OmniboxOutcome, t: OmniboxStrings) => {
  if (outcome.kind === "signedOut") {
    return t("signIn");
  }
  const key = NOTICES[outcome.kind];
  return key ? t(key) : undefined;
};

// Placeholders for Chromium's <match> tags, swapped in after escaping.
const MATCH_OPEN = "\u0001";
const MATCH_CLOSE = "\u0002";

/**
 * The default row, the one Enter on the typed text picks. In Chromium `%s`
 * is the typed text and the notice follows it. Firefox shows the typed text
 * beside the row itself, doesn't fill in `%s`, and keeps the row it had when
 * typing began, so its notices come as a row of their own (`noticeRow`).
 */
export function defaultSuggestion(
  outcome: OmniboxOutcome,
  flavor: OmniboxFlavor,
  t: OmniboxStrings
): string {
  if (outcome.kind === "signedOut") {
    return t("signIn");
  }
  if (flavor === "firefox") {
    return t("search");
  }
  const search = escapeXmlText(
    t.markup("searchFor", {
      match: (chunks) => `${MATCH_OPEN}${chunks}${MATCH_CLOSE}`,
      query: "%s",
    })
  )
    .replace(MATCH_OPEN, "<match>")
    .replace(MATCH_CLOSE, "</match>");
  const notice = noticeFor(outcome, t);
  return notice ? `${search} <dim>${escapeXmlText(notice)}</dim>` : search;
}

/**
 * Firefox's notice as a suggestion: choosing it searches the typed text, as
 * Enter does. Chromium shows its notices on the default row instead.
 */
export function noticeRow(
  outcome: OmniboxOutcome,
  text: string,
  flavor: OmniboxFlavor,
  t: OmniboxStrings
): OmniboxSuggestion | null {
  const notice = noticeFor(outcome, t);
  // Firefox drops a row whose content is exactly the typed text; the space
  // keeps it, and Enter trims it off.
  return flavor === "firefox" && notice && text.trim()
    ? { content: `${text.trim()} `, description: notice }
    : null;
}

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

export const searchUrl = (appUrl: string, text: string): string => {
  const url = new URL("/", appUrl);
  if (text.trim()) {
    url.searchParams.set("q", text.trim());
  }
  return url.href;
};

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
      const debounceDeadline = now + debounceMs;
      const maxWaitDeadline = pendingSince + minIntervalMs;
      const cooldownEnd = lastSentAt + minIntervalMs;
      const due = Math.max(
        Math.min(debounceDeadline, maxWaitDeadline),
        cooldownEnd
      );
      timer = clock.setTimeout(fire, Math.max(0, due - now));
    },
    cancel() {
      stop();
      pending = undefined;
      pendingSince = undefined;
    },
    reset() {
      stop();
      pending = undefined;
      pendingSince = undefined;
      lastSent = undefined;
    },
    allowResend(text: string) {
      if (lastSent === text) {
        lastSent = undefined;
      }
    },
  };
}

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
    q: truncateCodePoints(text.trim(), OMNIBOX_MAX_QUERY_LENGTH),
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
    throttle.allowResend(inflight.text);
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
            throttle.allowResend(text);
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
    reset() {
      throttle.reset();
      abort();
      current = "";
      answered = undefined;
    },
  };
}
