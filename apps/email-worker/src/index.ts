import PostalMime from "postal-mime";
import { DEFAULT_INBOUND_DOMAIN, isSaveAddress } from "./address";
import { type SelectedAttachment, selectAttachments } from "./attachments";
import { verifySender } from "./auth";
import {
  type ConvexTarget,
  finalizeAttachment,
  ingestEmail,
  type PlannedUpload,
} from "./convex";
import { buildPayload, DEFAULT_MAX_BODY_BYTES } from "./payload";
import type { Deps, Env, InboundMessage } from "./types";

// Save by email. Mail to save@<INBOUND_EMAIL_DOMAIN> from a Teak account's
// sign-in address, proven by DMARC, becomes cards: Convex plans the body card
// and hands back upload URLs for the attachments, which go straight to the
// Files Worker. Anything that can't be saved is refused while the sender's
// server is still connected; this Worker never sends mail. Logs carry
// outcomes and counts only, never addresses, subjects, bodies or file names.

export const REJECT_UNKNOWN_ADDRESS = "550 5.1.1 Unknown address";
export const REJECT_CANT_SAVE = "550 5.7.1 This address can't save to Teak";
export const REJECT_TOO_BIG = "552 5.3.4 Message too big";
export const REJECT_UNREADABLE = "550 5.6.0 Message could not be read";

/** Email Routing's own limit; anything larger never reaches a Worker. */
export const MAX_MESSAGE_BYTES = 25 * 1024 * 1024;
export const UPLOAD_RETRY_DELAYS_MS = [500, 1500];
export const UPLOAD_CONCURRENCY = 2;

const AUTO_PRECEDENCE = new Set(["bulk", "junk", "list"]);

/** Auto-replies, bounces and list traffic: never saved, never answered. */
export const isAutomated = (message: InboundMessage): boolean => {
  const autoSubmitted = message.headers
    .get("auto-submitted")
    ?.trim()
    .toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") {
    return true;
  }
  const envelopeFrom = message.from.trim();
  if (envelopeFrom === "" || envelopeFrom === "<>") {
    return true;
  }
  const precedence = message.headers.get("precedence")?.trim().toLowerCase();
  return Boolean(
    precedence &&
      AUTO_PRECEDENCE.has(precedence) &&
      message.headers.has("list-id")
  );
};

const maxBodyBytes = (env: Env): number => {
  const configured = Number(env.MAX_BODY_BYTES);
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : DEFAULT_MAX_BODY_BYTES;
};

const putWithRetries = async (
  deps: Deps,
  upload: PlannedUpload,
  attachment: SelectedAttachment
): Promise<boolean> => {
  for (let attempt = 0; attempt <= UPLOAD_RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await deps.sleep(UPLOAD_RETRY_DELAYS_MS[attempt - 1] ?? 0);
    }
    try {
      const response = await deps.fetch(upload.uploadUrl, {
        body: attachment.content,
        headers: { "content-type": attachment.mimeType },
        method: "PUT",
      });
      await response.body?.cancel().catch(() => undefined);
      if (response.ok) {
        return true;
      }
    } catch {
      // Retried below; a part that never uploads is skipped.
    }
  }
  return false;
};

/**
 * PUTs each attachment Convex asked for (two at a time), then asks Convex to
 * turn it into a card. A part that won't upload is skipped; its pending
 * object is swept later.
 */
export const uploadAttachments = async (
  deps: Deps,
  target: ConvexTarget,
  receiptKey: string,
  uploads: PlannedUpload[],
  attachments: SelectedAttachment[]
): Promise<Record<string, number>> => {
  const byIndex = new Map(attachments.map((part) => [part.index, part]));
  const counts: Record<string, number> = {};
  const count = (outcome: string) => {
    counts[outcome] = (counts[outcome] ?? 0) + 1;
  };
  const queue = [...uploads];
  const runner = async () => {
    for (let upload = queue.shift(); upload; upload = queue.shift()) {
      const attachment = byIndex.get(upload.index);
      if (!attachment) {
        count("unknown_index");
        continue;
      }
      if (!(await putWithRetries(deps, upload, attachment))) {
        count("upload_failed");
        continue;
      }
      count(
        await finalizeAttachment(deps, target, {
          fileKey: upload.fileKey,
          index: upload.index,
          receiptKey,
          size: attachment.size,
        })
      );
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queue.length) }, runner)
  );
  return counts;
};

export const handleEmail = async (
  message: InboundMessage,
  env: Env,
  deps: Deps
): Promise<void> => {
  const reject = (reason: string, rejection: string) => {
    message.setReject(rejection);
    deps.log({ event: "inbound_email", outcome: "rejected", reason });
  };
  if (
    !isSaveAddress(
      message.to,
      env.INBOUND_EMAIL_DOMAIN || DEFAULT_INBOUND_DOMAIN
    )
  ) {
    reject("unknown_address", REJECT_UNKNOWN_ADDRESS);
    return;
  }
  if (isAutomated(message)) {
    deps.log({
      event: "inbound_email",
      outcome: "skipped",
      reason: "automated",
    });
    return;
  }
  if (message.rawSize > MAX_MESSAGE_BYTES) {
    reject("too_big", REJECT_TOO_BIG);
    return;
  }
  const secret = env.EMAIL_INBOUND_SIGNING_SECRET;
  const siteUrl = env.CONVEX_SITE_URL;
  if (!(secret && siteUrl)) {
    // Thrown, so the sender retries once the Worker is configured.
    throw new Error("email_worker_not_configured");
  }
  let email: Awaited<ReturnType<typeof PostalMime.parse>>;
  try {
    email = await PostalMime.parse(message.raw);
  } catch {
    reject("unreadable", REJECT_UNREADABLE);
    return;
  }
  const verdict = verifySender(email);
  if (!verdict.ok) {
    reject(verdict.reason, REJECT_CANT_SAVE);
    return;
  }
  const attachments = selectAttachments(email);
  const target = { secret, siteUrl };
  const result = await ingestEmail(
    deps,
    target,
    buildPayload(email, verdict.from, attachments, maxBodyBytes(env))
  );
  if (result.kind === "unknown_sender") {
    reject("unknown_sender", REJECT_CANT_SAVE);
    return;
  }
  deps.log({
    attachments: attachments.length,
    event: "inbound_email",
    outcome: result.status,
    uploads: result.uploads.length,
  });
  if (!result.receiptKey || result.uploads.length === 0) {
    return;
  }
  const counts = await uploadAttachments(
    deps,
    target,
    result.receiptKey,
    result.uploads,
    attachments
  );
  deps.log({ event: "inbound_email_attachments", ...counts });
};

const defaultDeps: Deps = {
  fetch: (input, init) => fetch(input, init),
  log: (entry) => console.log(JSON.stringify(entry)),
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export default {
  async email(message: InboundMessage, env: Env): Promise<void> {
    await handleEmail(message, env, defaultDeps);
  },
};
