import type { HttpRouter } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  type ActionCtx,
  env,
  httpAction,
  internalAction,
} from "../_generated/server";
import { finalizeForUser } from "../card/uploadCardAction";
import { requireTeakUserId } from "../securitySessions";
import { readResponseTextWithinLimit } from "../shared/boundedResponse";
import { CARD_ERROR_CODES } from "../shared/constants";
import { inferFileFormat, MAX_FILE_NAME_LENGTH } from "../shared/fileFormats";
import { hmacSha256Hex, sha256Hex } from "../storage/r2Keys";
import { planEmailCards } from "./emailContent";

// Save by email's routes for the Email Worker (apps/email-worker). Each POST
// is signed with EMAIL_INBOUND_SIGNING_SECRET over the path, a timestamp
// within five minutes and the body's SHA-256. Shaped like workosWebhook.ts:
// 503 without the secret, 401 for a bad signature, 413 past the size limit,
// 200 for mail that is handled (saved or dropped on purpose), 404 for a
// sender to reject at SMTP, and 5xx only for what the sender should retry.

export const INBOUND_EMAIL_PATH = "/inbound/email";
export const INBOUND_ATTACHMENT_PATH = "/inbound/email/attachments";
export const INBOUND_HEADERS = {
  signature: "x-teak-signature",
  timestamp: "x-teak-timestamp",
} as const;

const MAX_EMAIL_REQUEST_BYTES = 3 * 1024 * 1024;
const MAX_ATTACHMENT_REQUEST_BYTES = 8 * 1024;
const SIGNATURE_WINDOW_SECONDS = 300;
const MAX_FIELD_CHARS = 998;
const SUBJECT_FIELD = "subject";

/** The exact string the Email Worker signs. */
export const inboundSigningPayload = (
  path: string,
  timestamp: string,
  bodySha256: string
) => `teak-inbound-email\nv1\n${path}\n${timestamp}\n${bodySha256}`;

const json = (status: number, body: unknown, headers: HeadersInit = {}) =>
  Response.json(body, { headers, status });

/** Compares two hex digests without leaking where they differ. */
const sameDigest = async (secret: string, given: string, wanted: string) => {
  const [left, right] = await Promise.all([
    hmacSha256Hex(secret, `compare\n${given}`),
    hmacSha256Hex(secret, `compare\n${wanted}`),
  ]);
  return left === right;
};

type Verified = { body: string } | { response: Response };

const readSigned = async (
  request: Request,
  path: string,
  maxBytes: number
): Promise<Verified> => {
  const secret = env.EMAIL_INBOUND_SIGNING_SECRET;
  if (!secret) {
    return { response: json(503, { error: "unavailable" }) };
  }
  const signature = request.headers.get(INBOUND_HEADERS.signature);
  const timestamp = request.headers.get(INBOUND_HEADERS.timestamp);
  if (
    !(signature && timestamp) ||
    signature.length !== 64 ||
    !/^\d{1,12}$/.test(timestamp)
  ) {
    return { response: json(401, { error: "invalid_signature" }) };
  }
  if (
    Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) >
    SIGNATURE_WINDOW_SECONDS
  ) {
    return { response: json(401, { error: "stale_signature" }) };
  }
  if (
    request.headers.get("content-type")?.split(";", 1)[0]?.trim() !==
    "application/json"
  ) {
    return { response: json(415, { error: "expected_json" }) };
  }
  const body = await readResponseTextWithinLimit(
    new Response(request.body),
    maxBytes
  );
  if (body === null) {
    return { response: json(413, { error: "too_large" }) };
  }
  const expected = await hmacSha256Hex(
    secret,
    inboundSigningPayload(path, timestamp, await sha256Hex(body))
  );
  if (!(await sameDigest(secret, signature.toLowerCase(), expected))) {
    return { response: json(401, { error: "invalid_signature" }) };
  }
  return { body };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const HIGH_SURROGATE_END_REGEX = /[\uD800-\uDBFF]$/u;

/** At most `max` UTF-16 units, never ending inside a surrogate pair. */
const cutText = (value: string, max: number): string => {
  if (value.length <= max) {
    return value;
  }
  const cut = value.slice(0, max);
  return HIGH_SURROGATE_END_REGEX.test(cut) ? cut.slice(0, -1) : cut;
};

const FILE_EXTENSION_REGEX = /\.[^.\s]{1,16}$/u;

/**
 * A long file name is cut to what uploads accept, before its extension,
 * which says its format.
 */
const cutFileName = (fileName: string): string => {
  const name = fileName.trim();
  if (name.length <= MAX_FILE_NAME_LENGTH) {
    return name;
  }
  const extension = FILE_EXTENSION_REGEX.exec(name)?.[0] ?? "";
  const stem = name.slice(0, name.length - extension.length);
  return cutText(stem, MAX_FILE_NAME_LENGTH - extension.length) + extension;
};

const optionalText = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.length > 0 ? cutText(value, max) : null;

interface InboundEmail {
  attachments: {
    fileName: string;
    index: number;
    mimeType: string;
    size: number;
  }[];
  date: string | null;
  from: string;
  html: string | null;
  messageId: string | null;
  /** The Subject header. */
  subjectLine: string;
  text: string | null;
}

/** The fields Convex reads; anything else the worker sends is ignored. */
export const parseInboundEmail = (value: unknown): InboundEmail | null => {
  if (!(isRecord(value) && value.v === 1 && typeof value.from === "string")) {
    return null;
  }
  const from = value.from.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(from) || from.length > 320) {
    return null;
  }
  const attachments = Array.isArray(value.attachments)
    ? value.attachments.flatMap((item) =>
        isRecord(item) &&
        Number.isSafeInteger(item.index) &&
        typeof item.fileName === "string" &&
        typeof item.mimeType === "string" &&
        Number.isSafeInteger(item.size) &&
        (item.size as number) >= 0
          ? [
              {
                fileName: cutFileName(item.fileName),
                index: item.index as number,
                mimeType: cutText(item.mimeType, 255),
                size: item.size as number,
              },
            ]
          : []
      )
    : [];
  return {
    attachments,
    date: optionalText(value.date, MAX_FIELD_CHARS),
    from,
    html: optionalText(value.html, MAX_EMAIL_REQUEST_BYTES),
    messageId: optionalText(value.messageId, MAX_FIELD_CHARS),
    // Read by name: `.subject` is reserved for auth identities by lint.
    subjectLine: optionalText(value[SUBJECT_FIELD], MAX_FIELD_CHARS) ?? "",
    text: optionalText(value.text, MAX_EMAIL_REQUEST_BYTES),
  };
};

/**
 * One key per delivered email, so a redelivery is recognized: its Message-ID,
 * or, without one, its sender, Date, subject and body. A later resend of the
 * same thing has a new Date and is saved again.
 */
export const inboundMessageKey = async (userId: string, email: InboundEmail) =>
  await sha256Hex(
    email.messageId
      ? `${userId}\nmessage-id\n${email.messageId}`
      : [
          userId,
          "fallback",
          email.from,
          email.date ?? "",
          email.subjectLine,
          await sha256Hex(`${email.text ?? ""}\n${email.html ?? ""}`),
        ].join("\n")
  );

const errorData = (error: unknown) =>
  error instanceof ConvexError
    ? (error.data as { code?: string; retryAt?: number } | undefined)
    : undefined;

export const inboundEmail = httpAction(async (ctx, request) => {
  const verified = await readSigned(
    request,
    INBOUND_EMAIL_PATH,
    MAX_EMAIL_REQUEST_BYTES
  );
  if ("response" in verified) {
    return verified.response;
  }
  let email: InboundEmail | null = null;
  try {
    email = parseInboundEmail(JSON.parse(verified.body));
  } catch {
    email = null;
  }
  if (!email) {
    return json(400, { error: "invalid_payload" });
  }
  const sender = await ctx.runQuery(internal.inbound.ingest.findSender, {
    email: email.from,
  });
  if (!sender) {
    return json(404, { error: "unknown_sender" });
  }
  try {
    const result = await ctx.runMutation(internal.inbound.ingest.ingestEmail, {
      attachments: email.attachments,
      messageKey: await inboundMessageKey(sender.userId, email),
      plan: planEmailCards({
        html: email.html,
        subject: email.subjectLine,
        text: email.text,
      }),
      userId: sender.userId,
    });
    if (result.status === "unknown_sender") {
      return json(404, { error: "unknown_sender" });
    }
    return json(200, result);
  } catch (error) {
    const data = errorData(error);
    if (data?.code === CARD_ERROR_CODES.RATE_LIMITED) {
      await ctx.scheduler.runAfter(
        0,
        internal.telemetry.events.emitInboundEmail,
        {
          event: "email_received",
          outcome: "deferred_rate",
          userId: sender.userId,
        }
      );
      const retryAfter = Math.max(
        1,
        Math.ceil(((data.retryAt ?? Date.now()) - Date.now()) / 1000)
      );
      return json(
        503,
        { error: "rate_limited" },
        { "retry-after": String(retryAfter) }
      );
    }
    console.error("inbound_email_failed", {
      code: data?.code ?? (error instanceof Error ? error.name : "unknown"),
    });
    return json(500, { error: "failed" });
  }
});

/** Why a finalize that failed for good drops its attachment, if it does. */
const dropReasonFor = (
  code: string | undefined
): "format" | "limit" | "size" | null => {
  if (code === CARD_ERROR_CODES.CARD_LIMIT_REACHED) {
    return "limit";
  }
  if (code === "FILE_TOO_LARGE") {
    return "size";
  }
  return code ? "format" : null;
};

type FinalizeOutcome =
  | { cardId: Id<"cards">; status: "saved" }
  | { status: "dropped" | "in_progress" | "scheduled" | "skipped" };

const finalizeAttachment = async (
  ctx: ActionCtx,
  args: {
    claimToken?: string;
    fileKey: string;
    index: number;
    receiptKey: string;
    size?: number;
  }
): Promise<FinalizeOutcome> => {
  const claim = await ctx.runMutation(
    internal.inbound.ingest.claimEmailAttachment,
    {
      ...(args.claimToken ? { claimToken: args.claimToken } : {}),
      fileKey: args.fileKey,
      index: args.index,
      receiptKey: args.receiptKey,
    }
  );
  if (claim.status !== "claimed") {
    return claim;
  }
  const held = {
    claimToken: claim.claimToken,
    index: args.index,
    receiptId: claim.receiptId,
  };
  try {
    const { cardId } = await finalizeForUser(
      ctx,
      await requireTeakUserId(ctx, claim.userId),
      {
        cardType: inferFileFormat({ fileName: claim.fileName })?.cardType,
        destinationObjectId: `email-${claim.receiptId}-${args.index}`,
        emailAttachment: held,
        fileKey: args.fileKey,
        fileName: claim.fileName,
        fileSize: args.size ?? claim.size,
        fileType: claim.mimeType,
        source: "email",
        tags: ["email"],
      }
    );
    await ctx.scheduler.runAfter(
      0,
      internal.telemetry.events.emitInboundEmail,
      {
        event: "email_attachment_saved",
        kind: inferFileFormat({ fileName: claim.fileName })?.kind ?? "other",
        sizeBytes: args.size ?? claim.size,
        userId: claim.userId,
      }
    );
    return { cardId, status: "saved" };
  } catch (error) {
    const data = errorData(error);
    if (data?.code === "IN_PROGRESS") {
      return { status: "in_progress" };
    }
    if (data?.code === CARD_ERROR_CODES.RATE_LIMITED) {
      // The card bucket refills within a minute; the object stays pending.
      await ctx.scheduler.runAt(
        data.retryAt ?? Date.now() + 60_000,
        internal.inbound.http.retryEmailAttachment,
        { ...args, claimToken: claim.claimToken }
      );
      return { status: "scheduled" };
    }
    const dropReason = dropReasonFor(data?.code);
    if (dropReason) {
      await ctx.runMutation(internal.inbound.ingest.dropEmailAttachment, {
        ...held,
        reason: dropReason,
      });
      return { status: dropReason === "limit" ? "dropped" : "skipped" };
    }
    await ctx.runMutation(internal.inbound.ingest.releaseEmailAttachment, held);
    throw error;
  }
};

export const retryEmailAttachment = internalAction({
  args: {
    claimToken: v.string(),
    fileKey: v.string(),
    index: v.number(),
    receiptKey: v.string(),
    size: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await finalizeAttachment(ctx, args);
    return null;
  },
});

export const inboundEmailAttachment = httpAction(async (ctx, request) => {
  const verified = await readSigned(
    request,
    INBOUND_ATTACHMENT_PATH,
    MAX_ATTACHMENT_REQUEST_BYTES
  );
  if ("response" in verified) {
    return verified.response;
  }
  let body: unknown;
  try {
    body = JSON.parse(verified.body);
  } catch {
    body = null;
  }
  if (
    !(
      isRecord(body) &&
      body.v === 1 &&
      typeof body.receiptKey === "string" &&
      body.receiptKey.length <= 64 &&
      Number.isSafeInteger(body.index) &&
      typeof body.fileKey === "string" &&
      body.fileKey.length <= 1024 &&
      (body.size === undefined || Number.isSafeInteger(body.size))
    )
  ) {
    return json(400, { error: "invalid_payload" });
  }
  try {
    const outcome = await finalizeAttachment(ctx, {
      fileKey: body.fileKey,
      index: body.index as number,
      receiptKey: body.receiptKey,
      ...(typeof body.size === "number" ? { size: body.size } : {}),
    });
    return json(
      outcome.status === "in_progress" || outcome.status === "scheduled"
        ? 202
        : 200,
      outcome
    );
  } catch (error) {
    const code = errorData(error)?.code;
    if (code === "NOT_FOUND") {
      return json(404, { error: "unknown_attachment" });
    }
    console.error("inbound_attachment_failed", {
      code: code ?? (error instanceof Error ? error.name : "unknown"),
    });
    return json(500, { error: "failed" });
  }
});

export const registerInboundRoutes = (http: HttpRouter) => {
  http.route({
    path: INBOUND_EMAIL_PATH,
    method: "POST",
    handler: inboundEmail,
  });
  http.route({
    path: INBOUND_ATTACHMENT_PATH,
    method: "POST",
    handler: inboundEmailAttachment,
  });
};
