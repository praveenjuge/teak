import { env, requireMailpit } from "./env";

export interface MailpitMessage {
  Bcc?: Array<{ Address: string }> | null;
  Cc?: Array<{ Address: string }> | null;
  Created?: string;
  From?: { Address: string } | null;
  ID: string;
  Subject: string;
  To?: Array<{ Address: string }> | null;
}

const api = (path: string) => `${env.mailpitUrl}/api/v1${path}`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const mailpitFetch = async (
  path: string,
  init?: RequestInit,
  deadline = Date.now() + 30_000
) => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error("Mailpit request deadline exceeded");
      }
      const timeout = AbortSignal.timeout(Math.min(10_000, remaining));
      return await fetch(api(path), {
        ...init,
        signal: init?.signal
          ? AbortSignal.any([init.signal, timeout])
          : timeout,
      });
    } catch (error) {
      lastError = error;
      if (attempt === 3 || Date.now() >= deadline) {
        break;
      }
      await sleep(Math.min(attempt * 1000, Math.max(0, deadline - Date.now())));
    }
  }
  throw lastError;
};

const hasRecipient = (message: MailpitMessage, email: string) =>
  (message.To ?? []).some(
    (recipient) => recipient.Address?.toLowerCase() === email
  );

export const assertMailpitReady = async () => {
  requireMailpit();
  const response = await mailpitFetch("/messages?limit=1");
  if (!response.ok) {
    throw new Error(`Mailpit not ready: ${response.status}`);
  }
};

export interface WaitForEmailOptions {
  excludeMessageIds?: ReadonlySet<string> | readonly string[];
  // Proven sender and request time. When set, only a message addressed solely
  // to the recipient, from that sender and created after the request counts,
  // and two such messages, or two distinct matching links, fail closed.
  fresh?: { from: string; sentAfter: number };
  linkPredicate?: (url: URL) => boolean;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

const safeMessageId = (id: string) => {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    throw new Error("Invalid Mailpit message ID");
  }
  return id;
};

const readJson = async (
  response: Response,
  deadline: number
): Promise<unknown> => {
  if (!response.ok) {
    throw new Error(`Mailpit request failed: ${response.status}`);
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Mailpit response body missing");
  }
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let timedOut = false;
  const timer = setTimeout(
    () => {
      timedOut = true;
      reader.cancel().catch(() => undefined);
    },
    Math.max(0, deadline - Date.now())
  );
  try {
    while (true) {
      const part = await reader.read();
      if (timedOut) {
        throw new Error("Mailpit response deadline exceeded");
      }
      if (part.done) {
        break;
      }
      bytes += part.value.length;
      if (bytes > 2 * 1024 * 1024) {
        await reader.cancel();
        throw new Error("Mailpit response exceeds size limit");
      }
      chunks.push(part.value);
    }
    return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
  } finally {
    clearTimeout(timer);
  }
};

const addresses = (value: unknown) =>
  value === null ||
  value === undefined ||
  (Array.isArray(value) &&
    value.every(
      (item: unknown) =>
        typeof item === "object" &&
        item !== null &&
        "Address" in item &&
        typeof item.Address === "string"
    ));

const readMessages = async (path: string, deadline: number) => {
  const data = await readJson(
    await mailpitFetch(path, undefined, deadline),
    deadline
  );
  if (
    typeof data !== "object" ||
    data === null ||
    !("messages" in data) ||
    !Array.isArray(data.messages)
  ) {
    throw new Error("Malformed Mailpit messages response");
  }
  const messages: MailpitMessage[] = [];
  for (const message of data.messages) {
    if (
      typeof message !== "object" ||
      message === null ||
      typeof message.ID !== "string" ||
      typeof message.Subject !== "string" ||
      !addresses(message.To) ||
      !addresses(message.Cc) ||
      !addresses(message.Bcc) ||
      !(
        message.From === null ||
        message.From === undefined ||
        addresses([message.From])
      ) ||
      !(message.Created === undefined || typeof message.Created === "string")
    ) {
      throw new Error("Malformed Mailpit message summary");
    }
    safeMessageId(message.ID);
    messages.push(message);
  }
  return {
    messages,
    total: "messages_count" in data ? data.messages_count : undefined,
  };
};

// Capture before requesting new mail. This reads summaries only and never deletes.
export const captureMailpitMessageIds = async (
  to: string,
  subject?: string
): Promise<Set<string>> => {
  requireMailpit();
  const ids = new Set<string>();
  const seen = new Set<string>();
  const deadline = Date.now() + 30_000;
  for (let start = 0; start < 5000; start += 100) {
    const page = await readMessages(
      `/messages?limit=100&start=${start}`,
      deadline
    );
    for (const message of page.messages) {
      seen.add(message.ID);
      if (
        hasRecipient(message, to.toLowerCase()) &&
        (subject === undefined || message.Subject === subject)
      ) {
        ids.add(message.ID);
      }
    }
    if (
      page.total !== undefined &&
      (!Number.isSafeInteger(page.total) ||
        Number(page.total) < 0 ||
        Number(page.total) > 5000)
    ) {
      throw new Error("Mailpit snapshot exceeds mailbox budget");
    }
    if (
      (page.total !== undefined && seen.size >= Number(page.total)) ||
      (page.total === undefined && page.messages.length < 100)
    ) {
      return ids;
    }
    if (page.messages.length === 0) {
      throw new Error("Mailpit snapshot incomplete");
    }
  }
  throw new Error("Mailpit snapshot incomplete");
};

const LINK_PATTERN = /https?:\/\/[^"' <\s]+/g;

const decodeAmpersands = (value: string) =>
  value.replace(/&amp;|&#38;|&#x26;/gi, "&");

const emailLink = (
  html: string,
  text: string,
  predicate?: (url: URL) => boolean,
  unique = false
) => {
  const content = predicate ? `${html}\n${text}` : html || text;
  const links = decodeAmpersands(content).match(LINK_PATTERN) ?? [];
  if (!predicate) {
    return links[0];
  }
  const matches = new Set<string>();
  for (const link of links) {
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      continue;
    }
    if (!(url.username || url.password) && predicate(url)) {
      if (!unique) {
        return url.href;
      }
      matches.add(url.href);
    }
  }
  return matches.size === 1 ? [...matches][0] : undefined;
};

const MAILPIT_CLOCK_SKEW_MS = 60_000;

const isFresh = (
  message: MailpitMessage,
  to: string,
  fresh: NonNullable<WaitForEmailOptions["fresh"]>
) => {
  const created = Date.parse(message.Created ?? "");
  return (
    message.To?.length === 1 &&
    message.To[0].Address.toLowerCase() === to &&
    !message.Cc?.length &&
    !message.Bcc?.length &&
    message.From?.Address.toLowerCase() === fresh.from.toLowerCase() &&
    Number.isFinite(created) &&
    created >= fresh.sentAfter - MAILPIT_CLOCK_SKEW_MS
  );
};

// Polls for one matching message and returns its parts. Callers must keep the
// body out of errors, logs and artifacts: it may hold a link token or a code.
const readEmail = async (
  to: string,
  subject: string,
  options: WaitForEmailOptions
) => {
  const timeoutMs = options.timeoutMs ?? 180_000;
  const pollIntervalMs = options.pollIntervalMs ?? 5000;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 180_000 ||
    !Number.isSafeInteger(pollIntervalMs) ||
    pollIntervalMs < 1 ||
    pollIntervalMs > 5000 ||
    (options.fresh &&
      !(
        options.fresh.from.includes("@") &&
        Number.isSafeInteger(options.fresh.sentAfter) &&
        options.fresh.sentAfter > 0
      ))
  ) {
    throw new Error("Invalid Mailpit polling limits");
  }
  const recipient = to.toLowerCase();
  const excluded = new Set(options.excludeMessageIds);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { messages } = await readMessages("/messages?limit=50", deadline);
    const hits = messages.filter(
      (message) =>
        message.Subject === subject &&
        hasRecipient(message, recipient) &&
        !excluded.has(message.ID) &&
        (!options.fresh || isFresh(message, recipient, options.fresh))
    );
    if (options.fresh && hits.length > 1) {
      throw new Error(`Ambiguous fresh ${subject} email for ${to}`);
    }
    const hit = hits[0];
    if (hit) {
      const body = await readJson(
        await mailpitFetch(
          `/message/${safeMessageId(hit.ID)}`,
          undefined,
          deadline
        ),
        deadline
      );
      if (
        typeof body !== "object" ||
        body === null ||
        ("HTML" in body && typeof body.HTML !== "string") ||
        ("Text" in body && typeof body.Text !== "string")
      ) {
        throw new Error("Malformed Mailpit message body");
      }
      return {
        id: hit.ID,
        html: "HTML" in body ? String(body.HTML) : "",
        text: "Text" in body ? String(body.Text) : "",
      };
    }
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
  }
  throw new Error(`Timed out waiting for ${subject} email to ${to}`);
};

export const waitForEmail = async (
  to: string,
  subject: string,
  options: WaitForEmailOptions = {}
) => {
  const { html, text } = await readEmail(to, subject, options);
  const link = emailLink(
    html,
    text,
    options.linkPredicate,
    options.fresh !== undefined
  );
  if (!link) {
    throw new Error(`Email ${subject} for ${to} had no matching link`);
  }
  return link;
};

// Accepts only an https link on the exact proven origin and path with exactly
// one non-empty token parameter. Origin, path and parameter come from root
// proof, never from the message.
export const exactLinkPredicate = (proof: {
  origin: string;
  param: string;
  pathname: string;
}) => {
  const origin = new URL(proof.origin);
  if (
    origin.protocol !== "https:" ||
    origin.origin !== proof.origin ||
    !proof.pathname.startsWith("/") ||
    !proof.param
  ) {
    throw new Error("Invalid proven link shape");
  }
  // Exact origin equality also pins the https scheme checked above.
  return (url: URL) =>
    url.origin === proof.origin &&
    url.pathname === proof.pathname &&
    !(url.username || url.password) &&
    url.searchParams.getAll(proof.param).length === 1 &&
    url.searchParams.get(proof.param) !== "";
};

// Reads a one-time code that must appear exactly once (as one distinct value)
// in the fresh message. The code pattern is a repository literal from root
// proof (never message or config input) and must carry the `g` flag, so it is
// used as-is. The code is never placed in an error; the message ID lets
// teardown delete it exactly.
export const waitForEmailCode = async (
  to: string,
  subject: string,
  codePattern: RegExp,
  options: WaitForEmailOptions & {
    fresh: NonNullable<WaitForEmailOptions["fresh"]>;
  }
) => {
  if (!codePattern.global || codePattern.sticky) {
    throw new Error("Email code pattern must be a global, non-sticky RegExp");
  }
  const { id, html, text } = await readEmail(to, subject, options);
  const content =
    text ||
    decodeAmpersands(html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " "));
  const codes = new Set(
    [...content.matchAll(codePattern)].map((match) => match[1] ?? match[0])
  );
  const [code] = codes;
  if (codes.size !== 1 || !code || code.length > 64) {
    throw new Error(`Email ${subject} for ${to} had no single matching code`);
  }
  return { code, messageId: id };
};

export const deleteMailpitMessages = async (messageIds: string[]) => {
  const uniqueMessageIds = [...new Set(messageIds)];
  if (uniqueMessageIds.length === 0) {
    return 0;
  }
  const response = await mailpitFetch("/messages", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ IDs: uniqueMessageIds }),
  });
  if (!response.ok) {
    throw new Error(`Mailpit message deletion failed: ${response.status}`);
  }
  return uniqueMessageIds.length;
};

export const messageIdsForRecipients = (
  messages: MailpitMessage[],
  emails: string[]
) => {
  const recipients = new Set(emails.map((email) => email.toLowerCase()));
  return messages
    .filter((message) =>
      (message.To ?? []).some((recipient) =>
        recipients.has(recipient.Address?.toLowerCase())
      )
    )
    .map((message) => message.ID);
};

export const deleteMessagesFor = async (email: string) => {
  try {
    const query = encodeURIComponent(`to:"${email.toLowerCase()}"`);
    const response = await mailpitFetch(`/search?query=${query}&limit=200`);
    if (!response.ok) {
      throw new Error(`Mailpit recipient search failed: ${response.status}`);
    }
    const data = (await response.json()) as { messages?: MailpitMessage[] };
    return await deleteMailpitMessages(
      messageIdsForRecipients(data.messages ?? [], [email])
    );
  } catch (error) {
    throw new Error(`Mailpit cleanup failed for ${email}: ${error}`);
  }
};

export const listMailpitMessages = async (limit = 500) => {
  const response = await mailpitFetch(`/messages?limit=${limit}`);
  if (!response.ok) {
    throw new Error(`Mailpit sweep list failed: ${response.status}`);
  }
  const data = (await response.json()) as { messages?: MailpitMessage[] };
  return data.messages ?? [];
};
