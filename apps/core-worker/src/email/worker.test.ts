import { afterEach, expect, spyOn, test } from "bun:test";
import { buildUploadSigningPayload } from "@teak/files-protocol";
import worker, { type Env } from "../index";
import { hmacSha256Hex } from "../lib";
import { fixture, messageOf } from "../test/emailSupport";
import { FakeBucket, withObjectGates } from "../test/testsupport";

const FILES_ORIGIN = "https://files.teakvault.com";
const FILES_SECRET = "test-files-secret";
const KEY = "users/u1/cards/upload-pending/attachment";
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

const signedUploadUrl = async (): Promise<string> => {
  const expiresAt = String(Math.floor(Date.now() / 1000) + 600);
  const signature = await hmacSha256Hex(
    FILES_SECRET,
    buildUploadSigningPayload({ contentType: "", expiresAt, key: KEY })
  );
  const url = new URL(`${FILES_ORIGIN}/__upload/v1/${encodeURIComponent(KEY)}`);
  url.searchParams.set("exp", expiresAt);
  url.searchParams.set("sig", signature);
  return url.toString();
};

test("posts to the primary Convex deployment and stores attachments in-process", async () => {
  const uploadUrl = await signedUploadUrl();
  const outbound: string[] = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    outbound.push(`${init?.method ?? "GET"} ${url}`);
    return Promise.resolve(
      url.endsWith("/inbound/email")
        ? Response.json({
            receiptKey: "receipt",
            status: "saved",
            uploads: [{ fileKey: KEY, index: 0, uploadUrl }],
          })
        : Response.json({ status: "saved" })
    );
  }) as typeof fetch;
  const logs: string[] = [];
  const log = spyOn(console, "log").mockImplementation((line: string) => {
    logs.push(line);
  });
  const bucket = new FakeBucket();
  const env = withObjectGates({
    BUCKET: bucket as unknown as R2Bucket,
    CONVEX_SITE_URLS: "https://primary.convex.site,https://other.convex.site",
    EMAIL_INBOUND_SIGNING_SECRET: "test-inbound-secret",
    FILES_PUBLIC_ORIGIN: FILES_ORIGIN,
    FILES_SIGNING_SECRET: FILES_SECRET,
    INBOUND_EMAIL_DOMAIN: "in.teakvault.com",
  }) as Env;
  const { message } = messageOf(fixture("attachments.eml"));

  try {
    await worker.email(message as unknown as ForwardableEmailMessage, env, {
      waitUntil: () => undefined,
    } as never);
  } finally {
    log.mockRestore();
  }

  expect(outbound).toEqual([
    "POST https://primary.convex.site/inbound/email",
    "POST https://primary.convex.site/inbound/email/attachments",
  ]);
  const stored = bucket.puts.find((put) => put.key === KEY);
  expect(stored?.bytes.byteLength).toBeGreaterThan(0);
  expect(logs.map((line) => JSON.parse(line))).toContainEqual({
    event: "inbound_email_attachments",
    saved: 1,
  });
});
