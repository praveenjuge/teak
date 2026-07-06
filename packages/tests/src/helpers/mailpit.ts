import { env, requireMailpit } from "./env";

interface MailpitMessage {
  ID: string;
  Subject: string;
  To: Array<{ Address: string }>;
}

const api = (path: string) => `${env.mailpitUrl}/api/v1${path}`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const assertMailpitReady = async () => {
  requireMailpit();
  const response = await fetch(api("/messages?limit=1"));
  if (!response.ok) {
    throw new Error(`Mailpit not ready: ${response.status}`);
  }
};

export const waitForEmail = async (to: string, subject: string) => {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const response = await fetch(api("/messages?limit=50"));
    if (!response.ok) {
      throw new Error(`Mailpit search failed: ${response.status}`);
    }
    const data = (await response.json()) as { messages?: MailpitMessage[] };
    const hit = data.messages?.find(
      (message) =>
        message.Subject === subject &&
        message.To.some((recipient) => recipient.Address.toLowerCase() === to)
    );
    if (hit) {
      const detail = await fetch(api(`/message/${hit.ID}`));
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

export const deleteMessagesFor = async (email: string) => {
  const response = await fetch(api("/messages?limit=100"));
  if (!response.ok) {
    return;
  }
  const data = (await response.json()) as { messages?: MailpitMessage[] };
  for (const message of data.messages ?? []) {
    if (
      message.To.some((recipient) => recipient.Address.toLowerCase() === email)
    ) {
      await fetch(api(`/message/${message.ID}`), { method: "DELETE" });
    }
  }
};
