import { describe, expect, test } from "bun:test";
import { createHash, createHmac } from "node:crypto";
import {
  fakeDeps,
  fixture,
  hang,
  json,
  messageOf,
  type RecordedRequest,
  TEST_ENV,
} from "../test/emailSupport";
import { CONVEX_TIMEOUT_MS } from "./convex";
import {
  handleEmail,
  REJECT_CANT_SAVE,
  REJECT_TOO_BIG,
  REJECT_UNKNOWN_ADDRESS,
  UPLOAD_TIMEOUT_MS,
} from "./index";

const INGEST_URL = "https://test-deployment.convex.site/inbound/email";
const FINALIZE_URL =
  "https://test-deployment.convex.site/inbound/email/attachments";

const saved = () =>
  json(200, { receiptKey: null, status: "saved", uploads: [] });

describe("handleEmail: who can send", () => {
  test("any address but save@ on the domain is refused before anything is read", async () => {
    const { message, rejections } = messageOf(fixture("plain.eml"), {
      to: "notes@in.teakvault.com",
    });
    const net = fakeDeps(saved);
    await handleEmail(message, TEST_ENV, net.deps);
    expect(rejections).toEqual([REJECT_UNKNOWN_ADDRESS]);
    expect(net.requests).toEqual([]);
  });

  test("save+anything@ in any letter case is the same address", async () => {
    const { message, rejections } = messageOf(fixture("plain.eml"), {
      to: "Save+Anything@In.TeakVault.com",
    });
    const net = fakeDeps(saved);
    await handleEmail(message, TEST_ENV, net.deps);
    expect(rejections).toEqual([]);
    expect(net.requests.map((request) => request.url)).toEqual([INGEST_URL]);
  });

  test.each([
    ["an auto-reply", fixture("auto-reply.eml"), "ada.example@gmail.com"],
    ["a bounce", fixture("plain.eml"), ""],
    ["a bounce with <>", fixture("plain.eml"), "<>"],
  ])(
    "%s is accepted and dropped, with no request and no reply",
    async (_name, eml, from) => {
      const { message, rejections } = messageOf(eml, { from });
      const net = fakeDeps(saved);
      await handleEmail(message, TEST_ENV, net.deps);
      expect(rejections).toEqual([]);
      expect(net.requests).toEqual([]);
      expect(net.logs).toEqual([
        { event: "inbound_email", outcome: "skipped", reason: "automated" },
      ]);
    }
  );

  test("list traffic marked bulk is dropped too", async () => {
    const eml = fixture("plain.eml").replace(
      "MIME-Version",
      "Precedence: bulk\r\nList-Id: <digest.example.com>\r\nMIME-Version"
    );
    const { message } = messageOf(eml);
    const net = fakeDeps(saved);
    await handleEmail(message, TEST_ENV, net.deps);
    expect(net.requests).toEqual([]);
  });

  test("a message over Email Routing's 25 MiB is refused", async () => {
    const { message, rejections } = messageOf(fixture("plain.eml"));
    const big = { ...message, rawSize: 25 * 1024 * 1024 + 1 };
    await handleEmail(big, TEST_ENV, fakeDeps(saved).deps);
    expect(rejections).toEqual([REJECT_TOO_BIG]);
  });

  test.each([
    "dmarc-fail.eml",
    "from-mismatch.eml",
    "no-cloudflare.eml",
    "forged-below.eml",
    "foreign-topmost.eml",
    "two-from.eml",
  ])("%s is refused without asking Convex", async (name) => {
    const { message, rejections } = messageOf(fixture(name));
    const net = fakeDeps(saved);
    await handleEmail(message, TEST_ENV, net.deps);
    expect(rejections).toEqual([REJECT_CANT_SAVE]);
    expect(net.requests).toEqual([]);
    expect(net.logs[0]).toMatchObject({ outcome: "rejected" });
  });

  test("Convex not knowing the sender refuses the message", async () => {
    const { message, rejections } = messageOf(fixture("plain.eml"));
    const net = fakeDeps(() => json(404, { error: "unknown_sender" }));
    await handleEmail(message, TEST_ENV, net.deps);
    expect(rejections).toEqual([REJECT_CANT_SAVE]);
    expect(net.requests).toHaveLength(1);
  });
});

describe("handleEmail: the request to Convex", () => {
  test("posts the verified sender and the message, signed over the exact body", async () => {
    const { message, rejections } = messageOf(fixture("multipart.eml"));
    let raw = "";
    const net = fakeDeps(saved);
    const deps = {
      ...net.deps,
      fetch: (input: string, init?: RequestInit) => {
        raw = String(init?.body);
        return net.deps.fetch(input, init);
      },
    };
    await handleEmail(message, TEST_ENV, deps);

    expect(rejections).toEqual([]);
    const [request] = net.requests as [RecordedRequest];
    expect(request.method).toBe("POST");
    expect(request.body).toEqual({
      attachments: [],
      // postal-mime gives the Date header as ISO 8601.
      date: "2026-10-14T09:30:00.000Z",
      from: "ada.example@gmail.com",
      html: "<p>HTML digest text.</p>\n",
      messageId: expect.stringContaining("@mail.gmail.com>"),
      subject: "Fwd: Weekly digest",
      text: "Plain digest text.\n",
      v: 1,
    });
    const timestamp = request.headers.get("x-teak-timestamp");
    expect(timestamp).toBe(String(Date.UTC(2026, 9, 14, 9, 30) / 1000));
    const bodyHash = createHash("sha256").update(raw).digest("hex");
    expect(request.headers.get("x-teak-signature")).toBe(
      createHmac("sha256", "test-inbound-secret")
        .update(
          `teak-inbound-email\nv1\n/inbound/email\n${timestamp}\n${bodyHash}`
        )
        .digest("hex")
    );
  });

  test("an HTML-only message sends its HTML and no text", async () => {
    const { message } = messageOf(fixture("html.eml"));
    const net = fakeDeps(saved);
    await handleEmail(message, TEST_ENV, net.deps);
    expect(net.requests[0]?.body).toMatchObject({
      html: expect.stringContaining("<h1>Sourdough</h1>"),
      text: null,
    });
  });

  test("bodies are cut to MAX_BODY_BYTES", async () => {
    const { message } = messageOf(fixture("plain.eml"));
    const net = fakeDeps(saved);
    await handleEmail(message, { ...TEST_ENV, MAX_BODY_BYTES: "10" }, net.deps);
    expect(net.requests[0]?.body).toMatchObject({ text: "https://ex" });
  });

  test("logs carry outcomes and counts, never the sender, subject or body", async () => {
    const { message } = messageOf(fixture("plain.eml"));
    const net = fakeDeps(saved);
    await handleEmail(message, TEST_ENV, net.deps);
    expect(net.logs).toEqual([
      { attachments: 0, event: "inbound_email", outcome: "saved", uploads: 0 },
    ]);
  });

  test("a busy Convex is retried, then the message is accepted", async () => {
    const { message, rejections } = messageOf(fixture("plain.eml"));
    const net = fakeDeps((_request, nth) =>
      nth < 2 ? json(503, { error: "rate_limited" }) : saved()
    );
    await handleEmail(message, TEST_ENV, net.deps);
    expect(net.requests).toHaveLength(3);
    expect(net.sleeps).toEqual([1000, 3000]);
    expect(rejections).toEqual([]);
  });

  test("a network error is retried like a 5xx", async () => {
    const { message } = messageOf(fixture("plain.eml"));
    const net = fakeDeps((_request, nth) => {
      if (nth === 0) {
        throw new TypeError("network down");
      }
      return saved();
    });
    await handleEmail(message, TEST_ENV, net.deps);
    expect(net.requests).toHaveLength(2);
  });

  test("a Convex that never answers is given up on and retried like a network error", async () => {
    const { message, rejections } = messageOf(fixture("plain.eml"));
    const net = fakeDeps((request, nth) => (nth < 2 ? hang(request) : saved()));
    await handleEmail(message, TEST_ENV, net.deps);
    expect(net.requests).toHaveLength(3);
    expect(net.timeouts).toEqual([
      CONVEX_TIMEOUT_MS,
      CONVEX_TIMEOUT_MS,
      CONVEX_TIMEOUT_MS,
    ]);
    expect(rejections).toEqual([]);
  });

  test("Convex down after three tries throws, so the sender retries later", async () => {
    const { message, rejections } = messageOf(fixture("plain.eml"));
    const net = fakeDeps(() => json(503, { error: "rate_limited" }));
    await expect(handleEmail(message, TEST_ENV, net.deps)).rejects.toThrow(
      "convex_status_503"
    );
    expect(net.requests).toHaveLength(3);
    expect(rejections).toEqual([]);
  });

  test.each([
    [401, "convex_status_401"],
    [400, "convex_status_400"],
    [404, "convex_status_404"],
  ])("a %i without a known meaning throws at once", async (status, error) => {
    const { message, rejections } = messageOf(fixture("plain.eml"));
    const net = fakeDeps(() => json(status, { error: "invalid" }));
    await expect(handleEmail(message, TEST_ENV, net.deps)).rejects.toThrow(
      error
    );
    expect(net.requests).toHaveLength(1);
    expect(rejections).toEqual([]);
  });

  test("a Worker without its secret throws before reading the message", async () => {
    const { message } = messageOf(fixture("plain.eml"));
    const net = fakeDeps(saved);
    await expect(
      handleEmail(
        message,
        { ...TEST_ENV, EMAIL_INBOUND_SIGNING_SECRET: undefined },
        net.deps
      )
    ).rejects.toThrow("email_worker_not_configured");
    expect(net.requests).toEqual([]);
  });
});

describe("handleEmail: attachments", () => {
  const uploadUrl = (index: number) =>
    `https://files.teakvault.com/upload/${index}?sig=x`;
  const planned = (indexes: number[]) =>
    json(200, {
      receiptKey: "receipt_1",
      status: "saved",
      uploads: indexes.map((index) => ({
        fileKey: `users/u1/pending/${index}`,
        index,
        uploadUrl: uploadUrl(index),
      })),
    });

  test("a saved answer whose body never arrives is asked again, so its attachments still go up", async () => {
    const { message } = messageOf(fixture("attachments.eml"));
    const stalledBody = () =>
      new Response(
        new ReadableStream({
          pull: (controller) =>
            controller.error(
              new DOMException("The operation timed out.", "TimeoutError")
            ),
        }),
        { status: 200 }
      );
    const net = fakeDeps((request, nth) => {
      if (request.url === INGEST_URL) {
        return nth === 0 ? stalledBody() : planned([0, 1, 2]);
      }
      if (request.method === "PUT") {
        return new Response(null, { status: 200 });
      }
      return json(200, { cardId: "card", status: "saved" });
    });
    await handleEmail(message, TEST_ENV, net.deps);

    const ingests = net.requests.filter(
      (request) => request.url === INGEST_URL
    );
    expect(ingests).toHaveLength(2);
    expect(
      net.requests.filter((request) => request.method === "PUT")
    ).toHaveLength(3);
  });

  test("each planned part is PUT, then finalized with its size", async () => {
    const { message } = messageOf(fixture("attachments.eml"));
    const net = fakeDeps((request) => {
      if (request.url === INGEST_URL) {
        return planned([0, 1, 2]);
      }
      if (request.method === "PUT") {
        return new Response(null, { status: 200 });
      }
      return json(200, { cardId: "card", status: "saved" });
    });
    await handleEmail(message, TEST_ENV, net.deps);

    expect(net.requests[0]?.body).toMatchObject({
      attachments: [
        {
          fileName: "IMG_0420.jpeg",
          index: 0,
          mimeType: "image/jpeg",
          size: 40_960,
        },
        {
          fileName: "itinerary.pdf",
          index: 1,
          mimeType: "application/pdf",
          size: 3016,
        },
        {
          fileName: "attachment-3.pdf",
          index: 2,
          mimeType: "application/pdf",
          size: 3016,
        },
      ],
    });
    const puts = net.requests.filter((request) => request.method === "PUT");
    expect(puts.map((request) => request.url).sort()).toEqual(
      [uploadUrl(0), uploadUrl(1), uploadUrl(2)].sort()
    );
    const photo = puts.find((request) => request.url === uploadUrl(0));
    expect(photo?.headers.get("content-type")).toBe("image/jpeg");
    expect((photo?.body as Uint8Array | undefined)?.byteLength).toBe(40_960);
    const finalizes = net.requests.filter(
      (request) => request.url === FINALIZE_URL
    );
    expect(
      finalizes
        .map((request) => request.body)
        .sort(
          (a, b) =>
            (a as { index: number }).index - (b as { index: number }).index
        )
    ).toEqual([
      {
        fileKey: "users/u1/pending/0",
        index: 0,
        receiptKey: "receipt_1",
        size: 40_960,
        v: 1,
      },
      {
        fileKey: "users/u1/pending/1",
        index: 1,
        receiptKey: "receipt_1",
        size: 3016,
        v: 1,
      },
      {
        fileKey: "users/u1/pending/2",
        index: 2,
        receiptKey: "receipt_1",
        size: 3016,
        v: 1,
      },
    ]);
    // Finalizes are signed for their own route.
    expect(finalizes[0]?.headers.get("x-teak-signature")).toMatch(
      /^[0-9a-f]{64}$/
    );
    expect(net.logs.at(-1)).toEqual({
      event: "inbound_email_attachments",
      saved: 3,
    });
  });

  test("no more than two uploads run at once", async () => {
    const { message } = messageOf(fixture("attachments.eml"));
    let inFlight = 0;
    let most = 0;
    const net = fakeDeps(async (request) => {
      if (request.url === INGEST_URL) {
        return planned([0, 1, 2]);
      }
      if (request.method === "PUT") {
        inFlight++;
        most = Math.max(most, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        return new Response(null, { status: 200 });
      }
      return json(200, { status: "saved" });
    });
    await handleEmail(message, TEST_ENV, net.deps);
    expect(most).toBe(2);
  });

  test("a failing PUT is retried twice; one that never works fails the delivery after the rest", async () => {
    const { message } = messageOf(fixture("attachments.eml"));
    const tries = new Map<string, number>();
    const net = fakeDeps((request) => {
      if (request.url === INGEST_URL) {
        return planned([0, 1]);
      }
      if (request.method === "PUT") {
        const seen = (tries.get(request.url) ?? 0) + 1;
        tries.set(request.url, seen);
        // Part 0 works on its third try; part 1 never does.
        const ok = request.url === uploadUrl(0) && seen === 3;
        return new Response(null, { status: ok ? 200 : 500 });
      }
      return json(200, { status: "saved" });
    });
    await expect(handleEmail(message, TEST_ENV, net.deps)).rejects.toThrow(
      "attachments_incomplete"
    );
    expect(tries.get(uploadUrl(0))).toBe(3);
    expect(tries.get(uploadUrl(1))).toBe(3);
    expect(
      net.requests
        .filter((request) => request.url === FINALIZE_URL)
        .map((request) => (request.body as { index: number }).index)
    ).toEqual([0]);
    expect(net.logs.at(-1)).toEqual({
      event: "inbound_email_attachments",
      saved: 1,
      upload_failed: 1,
    });
  });

  test("a PUT or finalize that never answers ends at its deadline and fails the delivery", async () => {
    const { message } = messageOf(fixture("attachments.eml"));
    const net = fakeDeps((request) => {
      if (request.url === INGEST_URL) {
        return planned([0, 1]);
      }
      if (request.method === "PUT") {
        return request.url === uploadUrl(0)
          ? hang(request)
          : new Response(null, { status: 200 });
      }
      return hang(request);
    });
    await expect(handleEmail(message, TEST_ENV, net.deps)).rejects.toThrow(
      "attachments_incomplete"
    );
    expect(net.logs.at(-1)).toEqual({
      event: "inbound_email_attachments",
      unreachable: 1,
      upload_failed: 1,
    });
    expect(net.timeouts).toContain(UPLOAD_TIMEOUT_MS);
  });

  test("a PUT the Core Worker refuses is skipped and the delivery succeeds", async () => {
    const { message } = messageOf(fixture("attachments.eml"));
    let puts = 0;
    const net = fakeDeps((request) => {
      if (request.url === INGEST_URL) {
        return planned([0]);
      }
      if (request.method === "PUT") {
        puts++;
        return new Response(null, { status: 403 });
      }
      return json(200, { status: "saved" });
    });
    await handleEmail(message, TEST_ENV, net.deps);
    expect(puts).toBe(1);
    expect(net.logs.at(-1)).toEqual({
      event: "inbound_email_attachments",
      upload_refused: 1,
    });
  });

  test("a finalize that keeps being throttled (429) is retried, then fails the delivery", async () => {
    const { message } = messageOf(fixture("attachments.eml"));
    let finalizes = 0;
    const net = fakeDeps((request) => {
      if (request.url === INGEST_URL) {
        return planned([0]);
      }
      if (request.method === "PUT") {
        return new Response(null, { status: 200 });
      }
      finalizes++;
      return json(429, { error: "slow_down" });
    });
    await expect(handleEmail(message, TEST_ENV, net.deps)).rejects.toThrow(
      "attachments_incomplete"
    );
    // Tried twice (one retry), as for a 5xx.
    expect(finalizes).toBe(2);
    expect(net.logs.at(-1)).toEqual({
      event: "inbound_email_attachments",
      status_429: 1,
    });
  });

  test("a finalize that keeps failing on the server fails the delivery, so the sender retries", async () => {
    const { message } = messageOf(fixture("attachments.eml"));
    const net = fakeDeps((request) => {
      if (request.url === INGEST_URL) {
        return planned([0, 1]);
      }
      if (request.method === "PUT") {
        return new Response(null, { status: 200 });
      }
      const { index } = request.body as { index: number };
      return index === 0
        ? json(200, { status: "saved" })
        : json(503, { error: "failed" });
    });
    await expect(handleEmail(message, TEST_ENV, net.deps)).rejects.toThrow(
      "attachments_incomplete"
    );
    expect(net.logs.at(-1)).toEqual({
      event: "inbound_email_attachments",
      saved: 1,
      status_503: 1,
    });
  });

  test("an old backend with no uploads leaves the attachments alone", async () => {
    const { message } = messageOf(fixture("attachments.eml"));
    const net = fakeDeps(() => json(200, { status: "saved" }));
    await handleEmail(message, TEST_ENV, net.deps);
    expect(net.requests.map((request) => request.method)).toEqual(["POST"]);
  });

  test("plain http is followed only to this machine (the local stack)", async () => {
    const { message } = messageOf(fixture("attachments.eml"));
    const net = fakeDeps((request) =>
      request.url === INGEST_URL
        ? json(200, {
            receiptKey: "receipt_1",
            status: "saved",
            uploads: [
              { fileKey: "k", index: 0, uploadUrl: "http://127.0.0.1:4102/up" },
            ],
          })
        : json(200, { status: "saved" })
    );
    await handleEmail(message, TEST_ENV, net.deps);
    expect(net.requests.map((request) => request.method)).toContain("PUT");
  });

  test("an upload URL that isn't https is ignored", async () => {
    const { message } = messageOf(fixture("attachments.eml"));
    const net = fakeDeps((request) =>
      request.url === INGEST_URL
        ? json(200, {
            receiptKey: "receipt_1",
            status: "saved",
            uploads: [
              { fileKey: "k", index: 0, uploadUrl: "http://169.254.169.254/x" },
            ],
          })
        : new Response(null, { status: 200 })
    );
    await handleEmail(message, TEST_ENV, net.deps);
    expect(net.requests).toHaveLength(1);
  });

  test("a finalize answer of 202 and a refused one are logged, not retried", async () => {
    const { message } = messageOf(fixture("attachments.eml"));
    const net = fakeDeps((request) => {
      if (request.url === INGEST_URL) {
        return planned([0, 1]);
      }
      if (request.method === "PUT") {
        return new Response(null, { status: 200 });
      }
      return (request.body as { index: number }).index === 0
        ? json(202, { status: "scheduled" })
        : json(409, { error: "conflict" });
    });
    await handleEmail(message, TEST_ENV, net.deps);
    expect(
      net.requests.filter((request) => request.url === FINALIZE_URL)
    ).toHaveLength(2);
    expect(net.logs.at(-1)).toEqual({
      event: "inbound_email_attachments",
      scheduled: 1,
      status_409: 1,
    });
  });
});
