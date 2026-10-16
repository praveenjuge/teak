import { WorkerEntrypoint } from "cloudflare:workers";

/**
 * Stands in for the Workers AI binding in the local E2E stack, which has no
 * Cloudflare account. The Files Worker's `AI` binding is a service binding to
 * this Worker there, and `env.AI.run(model, inputs)` reaches `run` over RPC.
 * Answers are deterministic, shaped like the real models' replies: chat
 * models return `{ choices, usage }` with the JSON object the prompts ask
 * for, Whisper returns `{ text }`, embedding models return `{ data }`.
 */

const STOP_WORDS = new Set(
  "about after again also analyze and are because been being content could does each from generate have into just like more most other over page some summary tags than that their them then there these they this those through title very what when where which while will with would your".split(
    " "
  )
);

const userText = (inputs: Record<string, unknown>): string => {
  const messages = Array.isArray(inputs.messages) ? inputs.messages : [];
  const user = [...messages]
    .reverse()
    .find((message: { role?: string }) => message?.role === "user") as
    | { content?: unknown }
    | undefined;
  if (typeof user?.content === "string") {
    return user.content;
  }
  if (Array.isArray(user?.content)) {
    return user.content
      .map((part: { text?: unknown }) =>
        typeof part?.text === "string" ? part.text : ""
      )
      .join(" ");
  }
  return "";
};

const hasImage = (inputs: Record<string, unknown>): boolean =>
  JSON.stringify(inputs.messages ?? "").includes('"image_url"');

const tagsFor = (text: string): string[] => {
  const words = text.toLowerCase().match(/[a-z][a-z0-9-]{3,}/gu) ?? [];
  const tags: string[] = [];
  for (const word of words) {
    if (!(STOP_WORDS.has(word) || tags.includes(word))) {
      tags.push(word);
    }
    if (tags.length === 4) {
      break;
    }
  }
  return tags.length > 0 ? tags : ["note"];
};

const summaryFor = (text: string): string => {
  const body = text
    .replace(/^[\s\S]*?(?:Content:|summary:)\s*/u, "")
    .replace(/\s+/gu, " ")
    .trim();
  return body
    ? `Saved note about ${body.slice(0, 120)}${body.length > 120 ? "…" : ""}`
    : "A saved note.";
};

const chatReply = (content: unknown, text: string) => ({
  choices: [{ message: { content: JSON.stringify(content) } }],
  usage: {
    completion_tokens: 40,
    prompt_tokens: Math.max(1, Math.ceil(text.length / 4)),
  },
});

export default class FakeWorkersAi extends WorkerEntrypoint {
  run(model: string, inputs: Record<string, unknown>): unknown {
    if (model.includes("whisper")) {
      return { text: "A short spoken note recorded for the local test." };
    }
    if (model.includes("bge") || model.includes("embedding")) {
      const count = Array.isArray(inputs.text) ? inputs.text.length : 1;
      return {
        data: Array.from({ length: count }, (_, row) =>
          Array.from({ length: 1024 }, (_, index) => Math.sin(row + index / 10))
        ),
        shape: [count, 1024],
      };
    }
    const text = userText(inputs);
    if (hasImage(inputs)) {
      return chatReply(
        {
          summary: "A photo analyzed by the local test model.",
          tags: ["photo", "local-test"],
        },
        text
      );
    }
    return chatReply({ summary: summaryFor(text), tags: tagsFor(text) }, text);
  }

  fetch(): Response {
    return new Response("Fake Workers AI for the local E2E stack.");
  }
}
