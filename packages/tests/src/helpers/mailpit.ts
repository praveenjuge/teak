import { env, requireMailpit } from "./env";

export interface MailpitMessage {
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
      (message.To !== null &&
        message.To !== undefined &&
        (!Array.isArray(message.To) ||
          message.To.some(
            (to: unknown) =>
              typeof to !== "object" ||
              to === null ||
              !("Address" in to) ||
              typeof to.Address !== "string"
          )))
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

const emailLink = (
  html: string,
  text: string,
  predicate?: (url: URL) => boolean
) => {
  const content = predicate ? `${html}\n${text}` : html || text;
  const links =
    content
      .replace(/&amp;|&#38;|&#x26;/gi, "&")
      .match(/https?:\/\/[^"' <\s]+/g) ?? [];
  if (!predicate) {
    return links[0];
  }
  for (const link of links) {
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      continue;
    }
    if (!(url.username || url.password) && predicate(url)) {
      return url.href;
    }
  }
};

export const waitForEmail = async (
  to: string,
  subject: string,
  options: WaitForEmailOptions = {}
) => {
  const timeoutMs = options.timeoutMs ?? 180_000;
  const pollIntervalMs = options.pollIntervalMs ?? 5000;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 180_000 ||
    !Number.isSafeInteger(pollIntervalMs) ||
    pollIntervalMs < 1 ||
    pollIntervalMs > 5000
  ) {
    throw new Error("Invalid Mailpit polling limits");
  }
  const excluded = new Set(options.excludeMessageIds);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { messages } = await readMessages("/messages?limit=50", deadline);
    const hit = messages.find(
      (message) =>
        message.Subject === subject &&
        hasRecipient(message, to.toLowerCase()) &&
        !excluded.has(message.ID)
    );
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
      const html = "HTML" in body ? String(body.HTML) : "";
      const text = "Text" in body ? String(body.Text) : "";
      const link = emailLink(html, text, options.linkPredicate);
      if (!link) {
        throw new Error(`Email ${subject} for ${to} had no matching link`);
      }
      return link;
    }
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
  }
  throw new Error(`Timed out waiting for ${subject} email to ${to}`);
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
