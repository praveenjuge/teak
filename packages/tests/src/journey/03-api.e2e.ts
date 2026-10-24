import { gzipSync } from "node:zlib";
import { apiFetch, loadOpenApi } from "../helpers/api";
import { createApiAccount } from "../helpers/app";
import { seedScenario } from "../helpers/seed";
import { expect, retry, test } from "../helpers/test";

let apiKey = "";
test.beforeAll(async () => {
  ({ apiKey } = await createApiAccount("service-api"));
});

test("REST API happy paths and OpenAPI contracts", async () => {
  const openapi = await loadOpenApi();
  for (const path of ["/v1/cards", "/v1/tags"]) {
    const response = await apiFetch(path, apiKey);
    expect(response.ok).toBe(true);
    openapi.validate(
      path,
      "GET",
      response.status,
      await response.clone().json()
    );
  }
  const created = await apiFetch("/v1/cards", apiKey, {
    method: "POST",
    body: JSON.stringify({
      content: `api-e2e-${Date.now()}`,
      tags: ["e2e"],
      source: "e2e",
    }),
  });
  const payload = await created.json();
  openapi.validate("/v1/cards", "POST", created.status, payload);
  const cardPath = `/v1/cards/${payload.cardId}`;
  expect((await apiFetch(cardPath, apiKey)).status).toBe(200);
  expect(
    (
      await apiFetch(`${cardPath}/favorite`, apiKey, {
        method: "PATCH",
        body: JSON.stringify({ isFavorited: true }),
      })
    ).status
  ).toBe(200);
  const titleUpdate = await apiFetch(cardPath, apiKey, {
    method: "PATCH",
    body: JSON.stringify({ metadataTitle: "  Native Mac title  " }),
  });
  expect(titleUpdate.status).toBe(200);
  expect(await titleUpdate.json()).toMatchObject({
    metadataTitle: "Native Mac title",
  });
  expect(
    (
      await apiFetch(cardPath, apiKey, {
        method: "PATCH",
        body: JSON.stringify({ notes: "updated by prod e2e" }),
      })
    ).status
  ).toBe(200);
  expect(await (await apiFetch(cardPath, apiKey)).json()).toMatchObject({
    metadataTitle: "Native Mac title",
    notes: "updated by prod e2e",
  });
  const clearedTitle = await apiFetch(cardPath, apiKey, {
    method: "PATCH",
    body: JSON.stringify({ metadataTitle: null }),
  });
  expect(clearedTitle.status).toBe(200);
  expect(await clearedTitle.json()).toMatchObject({ metadataTitle: null });
  expect(
    (
      await apiFetch("/v1/cards/bulk", apiKey, {
        method: "POST",
        body: JSON.stringify({
          operation: "create",
          items: [{ content: "bulk prod e2e" }],
        }),
      })
    ).status
  ).toBe(200);
  expect((await apiFetch("/v1/cards/not-a-card", apiKey)).status).toBe(404);
});

test("saving a URL as content creates a link card, not a text card", async () => {
  const bookUrl =
    "https://www.goodreads.com/book/show/2767052-the-hunger-games";
  const created = await apiFetch("/v1/cards", apiKey, {
    method: "POST",
    body: JSON.stringify({
      content: bookUrl,
      tags: ["e2e"],
      source: "e2e",
    }),
  });
  expect(created.status).toBe(200);
  const payload = await created.json();

  expect(payload.card?.type).toBe("link");
  expect(payload.card?.url).toBe(bookUrl);

  const fetched = await apiFetch(`/v1/cards/${payload.cardId}`, apiKey);
  expect(fetched.status).toBe(200);
  const fetchedPayload = await fetched.json();
  expect(fetchedPayload.type).toBe("link");
  expect(fetchedPayload.url).toBe(bookUrl);
});

test("a link is marked done and found with is:done; a note can't be", async () => {
  const openapi = await loadOpenApi();
  const url = `https://example.com/done-${Date.now()}`;
  const created = await apiFetch("/v1/cards", apiKey, {
    method: "POST",
    body: JSON.stringify({ content: url, source: "e2e" }),
  });
  const { cardId } = await created.json();
  const donePath = `/v1/cards/${cardId}/done`;

  const marked = await apiFetch(donePath, apiKey, { method: "POST" });
  expect(marked.status).toBe(200);
  const markedCard = await marked.json();
  openapi.validate("/v1/cards/{cardId}/done", "POST", 200, markedCard);
  expect(markedCard.completedAt).toEqual(expect.any(Number));
  const again = await (
    await apiFetch(donePath, apiKey, { method: "POST" })
  ).json();
  expect(again.completedAt).toBe(markedCard.completedAt);

  const done = await (
    await apiFetch(`/v1/cards?q=${encodeURIComponent("is:done")}`, apiKey)
  ).json();
  expect(done.items.map((item: { id: string }) => item.id)).toContain(cardId);
  const ids = async (q: string) => {
    const page = await (
      await apiFetch(`/v1/cards?q=${encodeURIComponent(q)}`, apiKey)
    ).json();
    return page.items.map((item: { id: string }) => item.id);
  };
  expect(await ids("(is:done OR tag:no-such-tag) -type:image")).toContain(
    cardId
  );
  expect(await ids("type:link -is:done")).not.toContain(cardId);

  const cleared = await apiFetch(donePath, apiKey, { method: "DELETE" });
  expect(cleared.status).toBe(200);
  const clearedCard = await cleared.json();
  openapi.validate("/v1/cards/{cardId}/done", "DELETE", 200, clearedCard);
  expect(clearedCard.completedAt).toBeNull();
  expect((await apiFetch(donePath, apiKey, { method: "DELETE" })).status).toBe(
    200
  );

  const note = await (
    await apiFetch("/v1/cards", apiKey, {
      method: "POST",
      body: JSON.stringify({ content: `done note ${Date.now()}` }),
    })
  ).json();
  const refused = await apiFetch(`/v1/cards/${note.cardId}/done`, apiKey, {
    method: "POST",
  });
  expect(refused.status).toBe(400);
  expect(await refused.json()).toMatchObject({ code: "TYPE_MISMATCH" });
});

test("Save PDF refuses a card that isn't an arXiv paper, and another account's card", async () => {
  const openapi = await loadOpenApi();
  const note = await (
    await apiFetch("/v1/cards", apiKey, {
      method: "POST",
      body: JSON.stringify({ content: `save pdf note ${Date.now()}` }),
    })
  ).json();
  const refused = await apiFetch(`/v1/cards/${note.cardId}/save-pdf`, apiKey, {
    method: "POST",
  });
  expect(refused.status).toBe(400);
  const body = await refused.json();
  expect(body).toMatchObject({ code: "INVALID_INPUT" });
  openapi.validate("/v1/cards/{cardId}/save-pdf", "POST", 400, body);

  const missing = await apiFetch("/v1/cards/not-a-card/save-pdf", apiKey, {
    method: "POST",
  });
  expect(missing.status).toBe(404);

  const other = await createApiAccount("service-api-other");
  const strangers = await apiFetch(
    `/v1/cards/${note.cardId}/save-pdf`,
    other.apiKey,
    {
      method: "POST",
    }
  );
  expect(strangers.status).toBe(404);
  expect(await strangers.json()).toMatchObject({ code: "NOT_FOUND" });
});

test("REST text cards preserve raw Markdown and enforce the UTF-8 limit", async () => {
  const marker = `api-markdown-${Date.now()}`;
  const original = `\uFEFF  # ${marker}\r\n\r\n- [ ] task  \r\nhttps://example.com  `;
  const created = await apiFetch("/v1/cards", apiKey, {
    method: "POST",
    body: JSON.stringify({
      cardType: "text",
      content: original,
      tags: ["e2e", "markdown"],
    }),
  });
  expect(created.status).toBe(200);
  const createdCard = await created.json();
  expect(createdCard.card).toMatchObject({
    content: original,
    type: "text",
  });

  const updated = `  ---\r\ntitle: ${marker}\r\n---\r\n\r\n| A | B |\r\n| - | - |\r\n`;
  const patched = await apiFetch(`/v1/cards/${createdCard.cardId}`, apiKey, {
    method: "PATCH",
    body: JSON.stringify({ content: updated }),
  });
  expect(patched.status).toBe(200);
  expect(await patched.json()).toMatchObject({
    content: updated,
    type: "text",
  });

  const listed = await apiFetch(
    `/v1/cards?include=content&q=${encodeURIComponent(marker)}`,
    apiKey
  );
  expect((await listed.json()).items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ content: updated, type: "text" }),
    ])
  );

  const exact = await apiFetch("/v1/cards", apiKey, {
    method: "POST",
    body: JSON.stringify({
      cardType: "text",
      content: "a".repeat(512 * 1024),
    }),
  });
  expect(exact.status).toBe(200);
  expect((await exact.json()).cardId).toBeTruthy();

  const oversized = await apiFetch("/v1/cards", apiKey, {
    method: "POST",
    body: JSON.stringify({
      cardType: "text",
      content: `${"a".repeat(512 * 1024)}b`,
    }),
  });
  expect(oversized.status).toBe(400);
  expect(await oversized.json()).toMatchObject({ code: "CONTENT_TOO_LARGE" });
});

test("saving a color as content creates a palette card, not a text card", async () => {
  const created = await apiFetch("/v1/cards", apiKey, {
    method: "POST",
    body: JSON.stringify({
      content: "#2050D0",
      tags: ["e2e"],
      source: "e2e",
    }),
  });
  expect(created.status).toBe(200);
  const payload = await created.json();

  await expect
    .poll(
      async () => {
        const fetched = await apiFetch(`/v1/cards/${payload.cardId}`, apiKey);
        if (!fetched.ok) {
          return null;
        }
        return (await fetched.json()).type;
      },
      { timeout: 30_000, interval: 2000 }
    )
    .toBe("palette");
});

test("a card's links and backlinks are on the card, not on lists", async () => {
  const openapi = await loadOpenApi();
  const create = async (content: string) =>
    (
      await (
        await apiFetch("/v1/cards", apiKey, {
          method: "POST",
          body: JSON.stringify({ content }),
        })
      ).json()
    ).cardId as string;
  const stamp = Date.now();
  const targetId = await create(`api-link-target-${stamp}`);
  const noteId = await create(`See [[Target|teak:${targetId}]] ${stamp}`);

  await retry(
    async () => {
      const note = await apiFetch(`/v1/cards/${noteId}`, apiKey);
      const body = await note.json();
      openapi.validate("/v1/cards/{cardId}", "GET", note.status, body);
      expect(body.links).toEqual([
        {
          id: targetId,
          missing: false,
          title: `api-link-target-${stamp}`,
          type: "text",
        },
      ]);
      const target = await (
        await apiFetch(`/v1/cards/${targetId}`, apiKey)
      ).json();
      expect(target.backlinks.map((card: { id: string }) => card.id)).toEqual([
        noteId,
      ]);
    },
    { timeout: 30_000 }
  );
  const listed = await (await apiFetch("/v1/cards?limit=5", apiKey)).json();
  for (const item of listed.items) {
    expect(item).not.toHaveProperty("links");
    expect(item).not.toHaveProperty("backlinks");
  }
});

test("a page snapshot becomes the link's saved copy", async () => {
  const marker = `page-snapshot-${Date.now()}`;
  const page = gzipSync(
    `<!doctype html><html><head><title>${marker}</title><script>alert(1)</script></head><body><h1>As the browser showed it</h1><p>${marker}</p></body></html>`
  );
  const upload = await apiFetch("/v1/page-snapshots/upload", apiKey, {
    method: "POST",
    body: JSON.stringify({ bytes: page.byteLength }),
  });
  expect(upload.status).toBe(200);
  const { fileKey, uploadUrl } = await upload.json();
  // The signed URL is the local Files Worker's, not the API's.
  // nosemgrep: rules_lgpl_javascript_ssrf_rule-node-ssrf
  const put = await fetch(uploadUrl, {
    body: page,
    headers: { "Content-Type": "application/gzip" },
    method: "PUT",
  });
  expect(put.status).toBe(200);

  const created = await apiFetch("/v1/cards", apiKey, {
    method: "POST",
    body: JSON.stringify({
      pageSnapshotKey: fileKey,
      url: `https://example.com/${marker}`,
    }),
  });
  expect(created.status).toBe(200);
  const { cardId } = await created.json();

  // The local stack has no link fetcher, so the run's other link steps fail;
  // the copy still comes from the snapshot, in a run of its own.
  await retry(
    async () => {
      const card = await (await apiFetch(`/v1/cards/${cardId}`, apiKey)).json();
      expect(card.archive).toMatchObject({ kind: "full" });
      expect(card.archive.bytes).toBeGreaterThan(0);
    },
    { intervals: [2000, 5000], timeout: 240_000 }
  );

  const tooLarge = await apiFetch("/v1/page-snapshots/upload", apiKey, {
    method: "POST",
    body: JSON.stringify({ bytes: 20 * 1024 * 1024 + 1 }),
  });
  expect(tooLarge.status).toBe(413);
  expect(await tooLarge.json()).toMatchObject({
    code: "PAGE_SNAPSHOT_TOO_LARGE",
  });
});

test("reads a link's article as Markdown only when asked for it", async () => {
  const { apiKey: readerKey, email } = await createApiAccount("api-reader");
  await seedScenario(email, "reader-mix");
  const openapi = await loadOpenApi();
  let card: { id: string } | undefined;
  await retry(
    async () => {
      const response = await apiFetch(
        "/v1/cards?q=%23scenario-reader&include=content,metadata&limit=50",
        readerKey
      );
      const { items } = (await response.json()) as {
        items: Array<{
          article: { readingMinutes: number; wordCount: number } | null;
          id: string;
          url: string | null;
        }>;
      };
      const longRead = items.find((item) =>
        item.url?.startsWith("https://example.com/reader/long-form")
      );
      expect(longRead?.article?.wordCount).toBeGreaterThan(2500);
      card = longRead;
    },
    { timeout: 60_000 }
  );
  const contentPath = `/v1/cards/${card?.id}/content`;

  const article = await apiFetch(`${contentPath}?kind=article`, readerKey);
  const body = await article.clone().json();
  openapi.validate("/v1/cards/{cardId}/content", "GET", article.status, body);
  expect(article.status).toBe(200);
  expect(body).toMatchObject({ kind: "article", truncated: false });
  expect(body.text).toContain("## Planting calendar");
  expect(body.text).toMatch(/!\[[^\]]*\]\(https?:\/\/\S+article-image\S+/u);
  expect(body.text).not.toContain("teak-image:");

  // Without kind, an article is never the answer: older clients reject it.
  const plain = await apiFetch(contentPath, readerKey);
  expect(plain.status).toBe(404);
  expect(await plain.json()).toMatchObject({ code: "NO_CONTENT" });
  expect((await apiFetch(`${contentPath}?kind=video`, readerKey)).status).toBe(
    400
  );
});

test("highlights a passage of a link's article by its quote, and lists it", async () => {
  const { apiKey: readerKey, email } = await createApiAccount("api-highlights");
  await seedScenario(email, "reader-mix");
  const openapi = await loadOpenApi();
  let cardId = "";
  await retry(
    async () => {
      const response = await apiFetch(
        "/v1/cards?q=%23scenario-reader&include=metadata&limit=50",
        readerKey
      );
      const { items } = (await response.json()) as {
        items: Array<{
          article: { wordCount: number } | null;
          id: string;
          url: string | null;
        }>;
      };
      const research = items.find((item) =>
        item.url?.startsWith("https://example.com/reader/research")
      );
      expect(research?.article?.wordCount).toBeGreaterThan(0);
      cardId = research?.id ?? "";
    },
    { timeout: 60_000 }
  );
  const path = `/v1/cards/${cardId}/highlights`;

  const created = await apiFetch(path, readerKey, {
    method: "POST",
    body: JSON.stringify({
      quote: "kept 31%  more moisture\nin July",
      note: "Worth trying",
    }),
  });
  const highlight = await created.clone().json();
  openapi.validate("/v1/cards/{cardId}/highlights", "POST", 201, highlight);
  expect(created.status).toBe(201);
  expect(highlight).toMatchObject({
    anchored: true,
    cardId,
    note: "Worth trying",
    quote: "kept 31% more moisture in July",
    source: "api",
  });

  const listed = await apiFetch(path, readerKey);
  const list = await listed.clone().json();
  openapi.validate("/v1/cards/{cardId}/highlights", "GET", 200, list);
  expect(list.items.map((item: { id: string }) => item.id)).toEqual([
    highlight.id,
  ]);
  const card = await (await apiFetch(`/v1/cards/${cardId}`, readerKey)).json();
  expect(card.highlightCount).toBe(1);

  const missing = await apiFetch(path, readerKey, {
    method: "POST",
    body: JSON.stringify({ quote: "a passage this abstract never had" }),
  });
  expect(missing.status).toBe(422);
  expect(await missing.json()).toMatchObject({ code: "QUOTE_NOT_FOUND" });

  const noted = await apiFetch(`/v1/highlights/${highlight.id}`, readerKey, {
    method: "PATCH",
    body: JSON.stringify({ note: null }),
  });
  expect(noted.status).toBe(200);
  expect(await noted.json()).toMatchObject({ note: null });
  const removed = await apiFetch(`/v1/highlights/${highlight.id}`, readerKey, {
    method: "DELETE",
  });
  expect(removed.status).toBe(204);
});
