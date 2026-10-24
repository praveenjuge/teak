import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction, type MutationCtx } from "../_generated/server";
import {
  type DevScenarioCardDef,
  insertCompletedCards,
} from "../card/defaultCards";
import { putObjectViaFilesWorker } from "../storage/filesWorkerClient";
import { buildR2ObjectKey } from "../storage/r2";

// `dead-links`: link cards with archived copies whose pages answer 404, 410,
// 403, 500, slowly or not at all, for the dead-link fallback (`/open`). By
// default they point at public test endpoints; an end-to-end run passes its
// own `origin`, a local server that answers the same paths.

export const DEAD_LINKS_TAG = "scenario-dead-links";
/** Answers `/status/<code>` with that status and `/delay/<s>` after s seconds. */
export const DEAD_LINKS_PUBLIC_ORIGIN = "https://httpbin.org";
/** `.invalid` never resolves (RFC 6761), so its A and AAAA are NXDOMAIN. */
export const DEAD_LINKS_NXDOMAIN_URL =
  "https://teak-dead-links.invalid/article";
/** When the copies were captured: a fixed date, so the bar's text is known. */
export const DEAD_LINKS_CAPTURED_AT = Date.UTC(2026, 9, 19, 9);

interface DeadLinkCase {
  archive: "full" | "text_only" | null;
  /** A path on the origin, or a whole URL. */
  path: string;
  slug: string;
  title: string;
  trashed?: true;
}

export const DEAD_LINK_CASES: readonly DeadLinkCase[] = [
  { slug: "404", path: "/status/404", title: "Gone: 404", archive: "full" },
  { slug: "410", path: "/status/410", title: "Gone: 410", archive: "full" },
  {
    slug: "nxdomain",
    path: DEAD_LINKS_NXDOMAIN_URL,
    title: "Gone: the domain no longer exists",
    archive: "full",
  },
  {
    slug: "403",
    path: "/status/403",
    title: "Refused: 403 (opens the original)",
    archive: "full",
  },
  {
    slug: "500",
    path: "/status/500",
    title: "Broken: 500 (opens the original)",
    archive: "full",
  },
  {
    slug: "slow",
    path: "/delay/6",
    title: "Slow: answers after 6 seconds (opens the original)",
    archive: "full",
  },
  {
    slug: "live",
    path: "/status/200",
    title: "Alive: 200 (opens the original)",
    archive: "full",
  },
  {
    slug: "no-archive",
    path: "/status/404?copy=none",
    title: "Gone, with no copy (opens the original)",
    archive: null,
  },
  {
    slug: "trashed",
    path: "/status/404?in=trash",
    title: "Gone, in Trash",
    archive: "full",
    trashed: true,
  },
  {
    slug: "text-only",
    path: "/status/410?copy=text",
    title: "Gone, kept as text only",
    archive: "text_only",
  },
];

/** The origin a run points at, without a trailing slash. */
export const deadLinksOrigin = (origin?: string): string => {
  if (origin === undefined) {
    return DEAD_LINKS_PUBLIC_ORIGIN;
  }
  const parsed = new URL(origin);
  if (!(parsed.protocol === "http:" || parsed.protocol === "https:")) {
    throw new Error("The dead-links origin must be an http(s) URL.");
  }
  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/u, "");
};

export const deadLinkUrl = (origin: string, path: string) =>
  /^https?:\/\//u.test(path) ? path : `${origin}${path}`;

interface StubArchive {
  key: string;
  kind: "full" | "text_only";
  title: string;
  url: string;
}

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/gu,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ] ?? char
  );

/**
 * A small archived page. Its script would rewrite the second paragraph if it
 * ran; the copy's sandbox must keep it from running.
 */
export const stubArchiveHtml = ({ kind, title, url }: StubArchive): string => {
  const safeTitle = escapeHtml(title);
  const safeUrl = escapeHtml(url);
  const body =
    kind === "text_only"
      ? `<h1>Text-only copy</h1><h2>${safeTitle}</h2><p>The page was too large to keep whole, so Teak kept its words. It was saved from ${safeUrl}.</p>`
      : `<h1>${safeTitle}</h1><p class="note">An archived copy from Teak's dead-links seed pack, saved from ${safeUrl}.</p><p id="scripts">Scripts are blocked in this copy.</p><script>document.getElementById("scripts").textContent = "Scripts ran in the archived copy.";</script><p>Archived pages bring their own colours, so the copy sits on white in both themes.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${safeTitle}</title><style>body{font:17px/1.6 Georgia,serif;max-width:38rem;margin:3rem auto;padding:0 1rem;color:#222}.note{color:#666}</style></head><body>${body}</body></html>`;
};

export const deadLinksScenario = (userId: string, origin: string) => {
  const archives: StubArchive[] = [];
  const cards = DEAD_LINK_CASES.map((item, index): DevScenarioCardDef => {
    const url = deadLinkUrl(origin, item.path);
    let pageArchive: DevScenarioCardDef["pageArchive"];
    if (item.archive) {
      const key = buildR2ObjectKey({
        userId,
        cardId: "seed-dead-links",
        role: "page-archive",
        objectId: item.slug,
        fileName: "archive.html",
      });
      const archive = { key, kind: item.archive, title: item.title, url };
      archives.push(archive);
      pageArchive = {
        storageKey: key,
        bytes: new TextEncoder().encode(stubArchiveHtml(archive)).byteLength,
        kind: item.archive,
        source: "server",
        capturedAt: DEAD_LINKS_CAPTURED_AT,
        sourceUrl: url,
      };
    }
    return {
      type: "link",
      content: url,
      url,
      metadataTitle: item.title,
      tags: [DEAD_LINKS_TAG],
      createdAt: DEAD_LINKS_CAPTURED_AT + index * 60_000,
      ...(pageArchive ? { pageArchive } : {}),
      ...(item.trashed ? { isDeleted: true } : {}),
    };
  });
  return { archives, cards };
};

/** Writes each archived copy the pack's cards point at. */
export const writeStubPageArchives = internalAction({
  args: {
    archives: v.array(
      v.object({
        key: v.string(),
        kind: v.union(v.literal("full"), v.literal("text_only")),
        title: v.string(),
        url: v.string(),
      })
    ),
  },
  returns: v.null(),
  handler: async (_ctx, { archives }) => {
    for (const archive of archives) {
      await putObjectViaFilesWorker({
        body: new TextEncoder().encode(stubArchiveHtml(archive)),
        contentType: "text/html; charset=utf-8",
        key: archive.key,
      });
    }
    return null;
  },
});

export const seedDeadLinks = async (
  ctx: MutationCtx,
  userId: string,
  origin: string
) => {
  const { archives, cards } = deadLinksScenario(userId, origin);
  const marker = cards[0]?.url;
  const seeded = marker
    ? await ctx.db
        .query("cards")
        .withIndex("by_user_url_deleted", (q) =>
          q.eq("userId", userId).eq("url", marker)
        )
        .first()
    : null;
  if (seeded) {
    return { status: "already_seeded" as const, cards: 0 };
  }
  await insertCompletedCards(ctx, userId, cards, { ignoreCardLimit: true });
  await ctx.scheduler.runAfter(
    0,
    internal.devSeed.deadLinks.writeStubPageArchives,
    { archives }
  );
  return { status: "seeded" as const, cards: cards.length };
};
