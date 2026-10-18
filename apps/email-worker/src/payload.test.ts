import { describe, expect, test } from "bun:test";
import { createHash, createHmac } from "node:crypto";
import {
  buildPayload,
  cutUtf8,
  SUBJECT_MAX_CHARS,
  signedHeaders,
  signingString,
} from "./payload";

describe("cutUtf8", () => {
  test("leaves text within the limit alone", () => {
    expect(cutUtf8("hello", 5)).toBe("hello");
  });

  test("never splits a character", () => {
    // "é" is 2 bytes, "日" 3, "😀" 4.
    expect(cutUtf8("aé", 2)).toBe("a");
    expect(cutUtf8("日本", 5)).toBe("日");
    expect(cutUtf8("😀😀", 7)).toBe("😀");
    const cut = cutUtf8("x".repeat(10) + "日".repeat(1000), 1024);
    expect(new TextEncoder().encode(cut).byteLength).toBeLessThanOrEqual(1024);
    expect(cut.endsWith("日")).toBe(true);
  });
});

describe("buildPayload", () => {
  test("carries the verified sender, the bodies cut to the limit, and attachment facts", () => {
    const payload = buildPayload(
      {
        date: "Tue, 14 Oct 2026 09:30:00 +0000",
        html: "<p>日本語</p>",
        messageId: "<m1@mail.gmail.com>",
        subject: "s".repeat(SUBJECT_MAX_CHARS + 5),
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
      subject: "s".repeat(SUBJECT_MAX_CHARS),
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
    expect(signingString("/inbound/email", "1792000000", "abc")).toBe(
      "teak-inbound-email\nv1\n/inbound/email\n1792000000\nabc"
    );
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
