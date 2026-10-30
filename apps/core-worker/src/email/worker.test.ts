import { afterEach, expect, spyOn, test } from "bun:test";
import worker, { type Env } from "../index";
import { fixture, messageOf } from "../test/emailSupport";
import { FakeBucket, withObjectGates } from "../test/testsupport";

// The Core Worker's email() entry point: which Convex deployment it posts to,
// and that attachment uploads to its own origin never leave the Worker.

const FILES_ORIGIN = "https://files.teakvault.com";
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("posts to the primary Convex deployment and stores attachments in-process", async () => {
  const outbound: string[] = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    outbound.push(`${init?.method ?? "GET"} ${url}`);
    return Promise.resolve(
      Response.json({
        receiptKey: "receipt",
        status: "saved",
        uploads: [
          {
            fileKey: "users/u1/cards/upload-pending/file",
            index: 0,
            // Unsigned, so this Worker's upload route refuses it.
            uploadUrl: `${FILES_ORIGIN}/__upload/v1/users%2Fu1%2Fcards%2Fupload-pending%2Ffile`,
          },
        ],
      })
    );
  }) as typeof fetch;
  const logs: string[] = [];
  const log = spyOn(console, "log").mockImplementation((line: string) => {
    logs.push(line);
  });
  const env = withObjectGates({
    BUCKET: new FakeBucket() as unknown as R2Bucket,
    CONVEX_SITE_URLS: "https://primary.convex.site,https://other.convex.site",
    EMAIL_INBOUND_SIGNING_SECRET: "test-inbound-secret",
    FILES_PUBLIC_ORIGIN: FILES_ORIGIN,
    FILES_SIGNING_SECRET: "test-files-secret",
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

  expect(outbound).toEqual(["POST https://primary.convex.site/inbound/email"]);
  expect(logs.map((line) => JSON.parse(line))).toContainEqual({
    event: "inbound_email_attachments",
    upload_refused: 1,
  });
});
