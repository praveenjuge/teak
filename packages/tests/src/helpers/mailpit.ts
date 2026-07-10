import { env, requireMailpit } from "./env";

export interface MailpitMessage {
  ID: string;
  Subject: string;
  To?: Array<{ Address: string }> | null;
}

const api = (path: string) => `${env.mailpitUrl}/api/v1${path}`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const mailpitFetch = async (path: string, init?: RequestInit) => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fetch(api(path), init);
    } catch (error) {
      lastError = error;
      await sleep(attempt * 1000);
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

export const waitForEmail = async (to: string, subject: string) => {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const response = await mailpitFetch("/messages?limit=50");
    if (!response.ok) {
      throw new Error(`Mailpit search failed: ${response.status}`);
    }
    const data = (await response.json()) as { messages?: MailpitMessage[] };
    const hit = data.messages?.find(
      (message) =>
        message.Subject === subject && hasRecipient(message, to.toLowerCase())
    );
    if (hit) {
      const detail = await mailpitFetch(`/message/${hit.ID}`);
      const body = (await detail.json()) as { HTML?: string; Text?: string };
      const link = (body.HTML || body.Text || "").match(
        /https?:\/\/[^"' <]+/
      )?.[0];
      if (!link) {
        throw new Error(`Email ${subject} for ${to} had no link`);
      }
      return link.replace(/&amp;/g, "&");
    }
    await sleep(5000);
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
