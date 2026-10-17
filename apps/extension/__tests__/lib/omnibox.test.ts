/// <reference types="bun" />
import { describe, expect, mock, test } from "bun:test";
import {
  buildSuggestions,
  cardUrlFrom,
  createInputThrottle,
  createOmniboxSearch,
  defaultSuggestion,
  noticeRow,
  OMNIBOX_RATE_LIMIT_PAUSE_MS,
  type OmniboxCard,
  type OmniboxOutcome,
  omniboxCardTitle,
  searchOmnibox,
  searchUrl,
  stillSignedOut,
} from "../../lib/omnibox";

const APP = "https://app.teakvault.com";

/** A clock whose timers run only when the test moves time forward. */
const fakeClock = () => {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  return {
    now: () => now,
    setTimeout: (run: () => void, ms: number) => {
      nextId += 1;
      timers.set(nextId, { at: now + ms, run });
      return nextId as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (handle: ReturnType<typeof setTimeout>) => {
      timers.delete(handle as unknown as number);
    },
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= end)
          .sort(([, a], [, b]) => a.at - b.at)[0];
        if (!due) {
          break;
        }
        timers.delete(due[0]);
        now = due[1].at;
        due[1].run();
      }
      now = end;
    },
  };
};

const card = (overrides: Partial<OmniboxCard> = {}): OmniboxCard => ({
  appUrl: `${APP}/?card=card_1`,
  type: "link",
  url: "https://example.com/post",
  metadataTitle: "A post",
  ...overrides,
});

describe("suggestion text", () => {
  test.each([
    ["&", "Tom &amp; Jerry", "Tom & Jerry"],
    [
      "<script>",
      "&lt;script&gt;alert(1)&lt;/script&gt;",
      "<script>alert(1)</script>",
    ],
    ["quotes", "&quot;Quoted&quot; &apos;title&apos;", `"Quoted" 'title'`],
  ])(
    "escapes %s for Chromium and leaves Firefox's plain text alone",
    (_label, xml, plain) => {
      const item = card({ metadataTitle: plain });
      expect(buildSuggestions([item], "chromium")[0]?.description).toBe(
        `${xml} <dim>link · example.com</dim>`
      );
      expect(buildSuggestions([item], "firefox")[0]?.description).toBe(
        `${plain} — link · example.com`
      );
    }
  );

  test("a suggestion opens its card", () => {
    expect(buildSuggestions([card()], "chromium")[0]?.content).toBe(
      `${APP}/?card=card_1`
    );
  });

  test("cuts long titles to 80 characters without splitting an emoji", () => {
    const long = `${"a".repeat(78)}🧪🧪🧪`;
    const title = buildSuggestions(
      [card({ metadataTitle: long })],
      "firefox"
    )[0]?.description.split(" — ")[0];
    expect(Array.from(title ?? "")).toHaveLength(80);
    expect(title).toBe(`${"a".repeat(78)}🧪…`);
    const cut = buildSuggestions(
      [card({ metadataTitle: "x".repeat(300) })],
      "chromium"
    )[0]?.description;
    expect(cut).toStartWith(`${"x".repeat(79)}…`);
  });

  test.each([
    ["RTL", "مرحبا بالعالم"],
    ["CJK", "東京の小さな喫茶店"],
  ])("keeps %s titles as they are", (_label, title) => {
    expect(
      buildSuggestions([card({ metadataTitle: title })], "chromium")[0]
        ?.description
    ).toStartWith(title);
  });

  test("names a card by its title, its first words, its site, then its type", () => {
    expect(omniboxCardTitle(card())).toBe("A post");
    expect(
      omniboxCardTitle(
        card({ metadataTitle: null, content: "  Line one\n\nline two\u0007" })
      )
    ).toBe("Line one line two");
    expect(
      omniboxCardTitle(
        card({
          type: "text",
          metadataTitle: "",
          content: "",
          url: null,
          sourceUrl: "https://xn--bcher-kva.example/page",
        })
      )
    ).toBe("bücher.example");
    expect(omniboxCardTitle({ appUrl: `${APP}/?card=c`, type: "image" })).toBe(
      "Untitled image"
    );
    expect(
      omniboxCardTitle(
        card({
          metadataTitle: "",
          content: "https://www.example.com/post",
          url: "https://www.example.com/post",
        })
      )
    ).toBe("example.com");
  });

  test("a card named by its host doesn't repeat it", () => {
    expect(
      buildSuggestions(
        [card({ metadataTitle: null, content: "https://example.com/post" })],
        "chromium"
      )[0]?.description
    ).toBe("example.com <dim>link</dim>");
  });

  test("a text card saved from a page shows that page's host", () => {
    expect(
      buildSuggestions(
        [
          card({
            type: "text",
            url: null,
            sourceUrl: "https://www.example.org/a",
            metadataTitle: null,
            content: "A quote",
          }),
        ],
        "chromium"
      )[0]?.description
    ).toBe("A quote <dim>text · example.org</dim>");
  });
});

describe("default suggestion", () => {
  test.each<[OmniboxOutcome["kind"], string]>([
    ["short", "Search Teak for <match>%s</match>"],
    ["results", "Search Teak for <match>%s</match>"],
    ["empty", "Search Teak for <match>%s</match> <dim>No matching cards</dim>"],
    [
      "error",
      "Search Teak for <match>%s</match> <dim>Couldn't reach Teak</dim>",
    ],
    [
      "rateLimited",
      "Search Teak for <match>%s</match> <dim>Too many searches, slow down</dim>",
    ],
    ["signedOut", "Sign in to Teak to search"],
  ])("%s", (kind, description) => {
    expect(
      defaultSuggestion({ kind, cards: [] } as OmniboxOutcome, "chromium")
    ).toBe(description);
  });

  test("Firefox, which fills in no %s, reads Search Teak", () => {
    expect(defaultSuggestion({ kind: "empty" }, "firefox")).toBe("Search Teak");
    expect(defaultSuggestion({ kind: "signedOut" }, "firefox")).toBe(
      "Sign in to Teak to search"
    );
  });
});

describe("noticeRow", () => {
  test.each<[OmniboxOutcome["kind"], string | null]>([
    ["empty", "No matching cards"],
    ["error", "Couldn't reach Teak"],
    ["rateLimited", "Too many searches, slow down"],
    ["signedOut", "Sign in to Teak to search"],
    ["short", null],
    ["results", null],
  ])("Firefox shows %s as a row that searches the text", (kind, notice) => {
    const outcome = { kind, cards: [] } as OmniboxOutcome;
    expect(noticeRow(outcome, " design ", "firefox")).toEqual(
      notice ? { content: "design ", description: notice } : null
    );
  });

  test("Chromium keeps notices on the default row", () => {
    expect(noticeRow({ kind: "empty" }, "design", "chromium")).toBeNull();
  });

  test("no text, no row", () => {
    expect(noticeRow({ kind: "empty" }, "  ", "firefox")).toBeNull();
  });
});

describe("stillSignedOut", () => {
  test.each<[OmniboxOutcome["kind"], boolean, boolean]>([
    ["signedOut", false, true],
    ["results", true, false],
    ["empty", true, false],
    ["error", true, false],
    ["short", true, true],
    ["rateLimited", true, true],
    ["rateLimited", false, false],
  ])("after %s, signed out %p stays %p", (kind, before, after) => {
    expect(stillSignedOut(before, { kind, cards: [] } as OmniboxOutcome)).toBe(
      after
    );
  });
});

describe("where Enter goes", () => {
  test("the search encodes the text", () => {
    expect(searchUrl(APP, " #design & type:image ")).toBe(
      `${APP}/?q=%23design+%26+type%3Aimage`
    );
    expect(searchUrl(APP, "東京 🧪")).toBe(
      `${APP}/?q=${encodeURIComponent("東京").replace(/%20/g, "+")}+${encodeURIComponent("🧪")}`
    );
    expect(searchUrl(APP, "   ")).toBe(`${APP}/`);
  });

  test("opens a card only for its app URL", () => {
    expect(cardUrlFrom(`${APP}/?card=card_1`, APP)).toBe(`${APP}/?card=card_1`);
  });

  test.each([
    ["another origin", "https://evil.example/?card=card_1"],
    ["a lookalike host", "https://app.teakvault.com.evil.example/?card=card_1"],
    ["credentials", "https://user:pass@app.teakvault.com/?card=card_1"],
    ["another path", `${APP}/settings?card=card_1`],
    ["a bad card id", `${APP}/?card=../../x`],
    ["javascript:", "javascript:alert(1)"],
    ["plain text", "design ideas"],
  ])("refuses %s", (_label, text) => {
    expect(cardUrlFrom(text, APP)).toBeNull();
  });
});

describe("input throttle", () => {
  test("sends at most once a second during a minute of fast typing", () => {
    const clock = fakeClock();
    const sent: Array<{ at: number; text: string }> = [];
    const throttle = createInputThrottle(
      { debounceMs: 400, minIntervalMs: 1000 },
      (text) => sent.push({ at: clock.now(), text }),
      clock
    );
    let text = "";
    for (let i = 0; i < 600; i += 1) {
      text += String.fromCharCode(97 + (i % 26));
      throttle.input(text);
      clock.advance(100);
    }
    clock.advance(1000);
    expect(sent.length).toBeLessThanOrEqual(61);
    expect(sent.length).toBeGreaterThan(50);
    for (let i = 1; i < sent.length; i += 1) {
      expect(sent[i]!.at - sent[i - 1]!.at).toBeGreaterThanOrEqual(1000);
    }
    expect(sent.at(-1)?.text).toBe(text);
  });

  test("waits for a 400 ms pause and sends only the latest text", () => {
    const clock = fakeClock();
    const send = mock((_text: string) => undefined);
    const throttle = createInputThrottle(
      { debounceMs: 400, minIntervalMs: 1000 },
      send,
      clock
    );
    throttle.input("de");
    clock.advance(200);
    throttle.input("des");
    clock.advance(399);
    expect(send).not.toHaveBeenCalled();
    clock.advance(1);
    expect(send.mock.calls).toEqual([["des"]]);
  });

  test("text typed inside the window waits for its end", () => {
    const clock = fakeClock();
    const sent: Array<{ at: number; text: string }> = [];
    const throttle = createInputThrottle(
      { debounceMs: 400, minIntervalMs: 1000 },
      (text) => sent.push({ at: clock.now(), text }),
      clock
    );
    throttle.input("de");
    clock.advance(400);
    throttle.input("des");
    clock.advance(400);
    throttle.input("desi");
    clock.advance(2000);
    expect(sent).toEqual([
      { at: 400, text: "de" },
      { at: 1400, text: "desi" },
    ]);
  });

  test("sends nothing for text it already sent", () => {
    const clock = fakeClock();
    const send = mock((_text: string) => undefined);
    const throttle = createInputThrottle(
      { debounceMs: 400, minIntervalMs: 1000 },
      send,
      clock
    );
    throttle.input("design");
    clock.advance(2000);
    throttle.input("design");
    clock.advance(2000);
    expect(send).toHaveBeenCalledTimes(1);
    throttle.forget("design");
    throttle.input("design");
    clock.advance(2000);
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe("searchOmnibox", () => {
  const signal = new AbortController().signal;

  test("asks for five keyword matches with their content", async () => {
    const request = mock(async (_path: string, _init?: RequestInit) =>
      Response.json({ items: [card()] })
    );
    expect(await searchOmnibox(" #design ", signal, request)).toEqual({
      kind: "results",
      cards: [card()],
    });
    const url = new URL(request.mock.calls[0]?.[0] ?? "", APP);
    expect(url.pathname).toBe("/v1/cards");
    expect(url.searchParams.get("q")).toBe("#design");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.get("include")).toBe("content");
    expect(url.searchParams.get("mode")).toBe("keyword");
    expect(request.mock.calls[0]?.[1]?.signal).toBe(signal);
  });

  test("cuts a very long query", async () => {
    const request = mock(async (_path: string, _init?: RequestInit) =>
      Response.json({ items: [] })
    );
    await searchOmnibox("🧪".repeat(800), signal, request);
    const q = new URL(request.mock.calls[0]?.[0] ?? "", APP).searchParams.get(
      "q"
    );
    expect(Array.from(q ?? "")).toHaveLength(500);
  });

  test.each<[string, () => Promise<Response | null>, OmniboxOutcome]>([
    ["no matches", async () => Response.json({ items: [] }), { kind: "empty" }],
    ["signed out", async () => null, { kind: "signedOut" }],
    [
      "429",
      async () => Response.json({ code: "RATE_LIMITED" }, { status: 429 }),
      { kind: "rateLimited" },
    ],
    ["500", async () => new Response("", { status: 500 }), { kind: "error" }],
    ["a bad body", async () => new Response("<html>"), { kind: "error" }],
    [
      "offline",
      () => Promise.reject(new TypeError("Failed to fetch")),
      { kind: "error" },
    ],
  ])("%s", async (_label, request, outcome) => {
    expect(await searchOmnibox("design", signal, request)).toEqual(outcome);
  });
});

describe("an address-bar session", () => {
  const setup = () => {
    const clock = fakeClock();
    const shown: [string, OmniboxOutcome["kind"]][] = [];
    const requests: Array<{
      resolve: (outcome: OmniboxOutcome) => void;
      signal: AbortSignal;
      text: string;
    }> = [];
    const session = createOmniboxSearch({
      clock,
      search: (text, signal) =>
        new Promise((resolve) => requests.push({ resolve, signal, text })),
      show: (text, outcome) => shown.push([text, outcome.kind]),
    });
    return { clock, requests, session, shown };
  };
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const results: OmniboxOutcome = { kind: "results", cards: [card()] };

  test("fewer than two characters only shows the default", () => {
    const { clock, requests, session, shown } = setup();
    session.input("d");
    session.input("   ");
    clock.advance(5000);
    expect(requests).toHaveLength(0);
    expect(shown).toEqual([
      ["d", "short"],
      ["", "short"],
    ]);
  });

  test("new text cancels the request in flight, and its late answer is dropped", async () => {
    const { clock, requests, session, shown } = setup();
    session.input("des");
    clock.advance(400);
    session.input("desi");
    expect(requests[0]?.signal.aborted).toBe(true);
    requests[0]?.resolve(results);
    clock.advance(1000);
    expect(requests.map((request) => request.text)).toEqual(["des", "desi"]);
    requests[1]?.resolve({ kind: "empty" });
    await flush();
    expect(shown).toEqual([["desi", "empty"]]);
  });

  test("text searched before answers again without a request", async () => {
    const { clock, requests, session, shown } = setup();
    session.input("design");
    clock.advance(400);
    requests[0]?.resolve(results);
    await flush();
    session.input("designs");
    session.input("design ");
    clock.advance(5000);
    expect(requests).toHaveLength(1);
    expect(shown).toEqual([
      ["design", "results"],
      ["design", "results"],
    ]);
  });

  test("a 429 pauses searching for five seconds", async () => {
    const { clock, requests, session, shown } = setup();
    session.input("design");
    clock.advance(400);
    requests[0]?.resolve({ kind: "rateLimited" });
    await flush();
    session.input("designs");
    clock.advance(OMNIBOX_RATE_LIMIT_PAUSE_MS - 1);
    session.input("designs!");
    clock.advance(1);
    expect(requests).toHaveLength(1);
    session.input("design s");
    clock.advance(1000);
    expect(requests.map((request) => request.text)).toEqual([
      "design",
      "design s",
    ]);
    expect(shown).toEqual([
      ["design", "rateLimited"],
      ["designs", "rateLimited"],
      ["designs!", "rateLimited"],
    ]);
  });

  test("an error is retried when the same text comes back", async () => {
    const { clock, requests, session } = setup();
    session.input("design");
    clock.advance(400);
    requests[0]?.resolve({ kind: "error" });
    await flush();
    session.input("designs");
    clock.advance(1000);
    session.input("design");
    clock.advance(1000);
    expect(requests.map((request) => request.text)).toEqual([
      "design",
      "designs",
      "design",
    ]);
  });

  test("reset forgets the session", async () => {
    const { clock, requests, session } = setup();
    session.input("design");
    clock.advance(400);
    requests[0]?.resolve(results);
    await flush();
    session.reset();
    session.input("design");
    clock.advance(1000);
    expect(requests).toHaveLength(2);
  });
});
