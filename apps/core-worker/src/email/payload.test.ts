import { describe, expect, test } from "bun:test";
import { createHash, createHmac } from "node:crypto";
import {
  buildInboundEmailSigningPayload,
  INBOUND_EMAIL_FIELD_MAX_CHARS,
  INBOUND_EMAIL_MAX_REQUEST_BYTES,
} from "@teak/files-protocol";
import {
  buildPayload,
  cutJsonUtf8,
  DEFAULT_MAX_BODY_BYTES,
  maxBodyBytes,
  signedHeaders,
} from "./payload";

describe("cutJsonUtf8", () => {
  test("leaves text within the limit alone", () => {
    expect(cutJsonUtf8("hello", 5)).toBe("hello");
  });

  test("never splits a character", () => {
    // "é" is 2 bytes, "日" 3, "😀" 4.
    expect(cutJsonUtf8("aé", 2)).toBe("a");
    expect(cutJsonUtf8("日本", 5)).toBe("日");
    expect(cutJsonUtf8("😀😀", 7)).toBe("😀");
    const cut = cutJsonUtf8("x".repeat(10) + "日".repeat(1000), 1024);
    expect(new TextEncoder().encode(cut).byteLength).toBeLessThanOrEqual(1024);
    expect(cut.endsWith("日")).toBe(true);
  });

  test("sizes the text as JSON, so escaped characters count twice or more", () => {
    // A quote encodes as 2 bytes, a control character as 6.
    expect(cutJsonUtf8('a"b', 3)).toBe('a"');
    expect(cutJsonUtf8("\u0001\u0001", 7)).toBe("\u0001");
    const quotes = cutJsonUtf8('"'.repeat(1024 * 1024), 1024 * 1024);
    expect(quotes.length).toBe(512 * 1024);
  });
});

describe("maxBodyBytes", () => {
  test.each([
    [undefined, DEFAULT_MAX_BODY_BYTES],
    ["0", DEFAULT_MAX_BODY_BYTES],
    ["lots", DEFAULT_MAX_BODY_BYTES],
    ["2048", 2048],
  ])("reads %p as %i", (configured, bytes) => {
    expect(maxBodyBytes(configured)).toBe(bytes);
  });

  test("a setting too large for Convex's request limit still sends a request it accepts", () => {
    const attachments = Array.from({ length: 50 }, (_, index) => ({
      content: new Uint8Array([1]),
      fileName: `${"n".repeat(200)}.pdf`,
      index,
      mimeType: "application/pdf",
      size: 1,
    }));
    const payload = buildPayload(
      {
        date: "d".repeat(INBOUND_EMAIL_FIELD_MAX_CHARS),
        html: "\u0001".repeat(2 * 1024 * 1024),
        messageId: "m".repeat(INBOUND_EMAIL_FIELD_MAX_CHARS),
        subject: "\u0001".repeat(INBOUND_EMAIL_FIELD_MAX_CHARS),
        text: "\u0001".repeat(2 * 1024 * 1024),
      },
      "ada.example@gmail.com",
      attachments,
      maxBodyBytes(String(8 * 1024 * 1024))
    );
    const body = new TextEncoder().encode(JSON.stringify(payload));
    expect(body.byteLength).toBeLessThanOrEqual(
      INBOUND_EMAIL_MAX_REQUEST_BYTES
    );
  });
});

describe("buildPayload", () => {
  test("a body of escaped characters still fits the backend's 3 MiB request", () => {
    const payload = buildPayload(
      {
        html: "\\".repeat(1024 * 1024),
        subject: '"'.repeat(INBOUND_EMAIL_FIELD_MAX_CHARS),
        text: '"'.repeat(1024 * 1024),
      },
      "ada.example@gmail.com",
      [],
      1024 * 1024
    );
    const body = new TextEncoder().encode(JSON.stringify(payload));
    expect(body.byteLength).toBeLessThanOrEqual(3 * 1024 * 1024);
    expect(payload.text?.length).toBe(512 * 1024);
  });

  test("carries the verified sender, the bodies cut to the limit, and attachment facts", () => {
    const payload = buildPayload(
      {
        date: "Tue, 14 Oct 2026 09:30:00 +0000",
        html: "<p>日本語</p>",
        messageId: "<m1@mail.gmail.com>",
        subject: "s".repeat(INBOUND_EMAIL_FIELD_MAX_CHARS + 5),
        text: "plain",
      },
      "ada.example@gmail.com",
      [
        {
          content: new Uint8Array([1]),
          fileName: "a.pdf",
          index: 0,
          mimeType: "application/pdf",
          size: 1,
        },
      ],
      8
    );
    expect(payload).toEqual({
      attachments: [
        { fileName: "a.pdf", index: 0, mimeType: "application/pdf", size: 1 },
      ],
      date: "Tue, 14 Oct 2026 09:30:00 +0000",
      from: "ada.example@gmail.com",
      html: "<p>日",
      messageId: "<m1@mail.gmail.com>",
      subject: "s".repeat(INBOUND_EMAIL_FIELD_MAX_CHARS),
      text: "plain",
      v: 1,
    });
  });

  test("missing parts are null, and an empty subject is empty", () => {
    expect(buildPayload({}, "a@example.com", [], 100)).toEqual({
      attachments: [],
      date: null,
      from: "a@example.com",
      html: null,
      messageId: null,
      subject: "",
      text: null,
      v: 1,
    });
  });
});

describe("signing", () => {
  test("the signed string binds the route, the time and the body hash", () => {
    expect(
      buildInboundEmailSigningPayload("/inbound/email", "1792000000", "abc")
    ).toBe("teak-inbound-email\nv1\n/inbound/email\n1792000000\nabc");
  });

  test("the signature is HMAC-SHA256 hex of that string", async () => {
    const body = '{"v":1}';
    const now = 1_792_000_000_123;
    const headers = await signedHeaders("secret", "/inbound/email", body, now);
    const bodyHash = createHash("sha256").update(body).digest("hex");
    const expected = createHmac("sha256", "secret")
      .update(`teak-inbound-email\nv1\n/inbound/email\n1792000000\n${bodyHash}`)
      .digest("hex");
    expect(headers).toEqual({
      "content-type": "application/json",
      "x-teak-signature": expected,
      "x-teak-timestamp": "1792000000",
    });
  });
});
