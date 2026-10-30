import { apiFetch } from "../helpers/api";
import { createApiAccount } from "../helpers/app";
import { expect, retry, test } from "../helpers/test";

interface ApiCard {
  aiSummary: string | null;
  aiTags: string[];
  id: string;
  processingStatus: Record<string, { status: string }> | null;
}

let apiKey = "";
test.beforeAll(async () => {
  ({ apiKey } = await createApiAccount("background-work"));
});

const readCard = async (cardId: string): Promise<ApiCard> => {
  const response = await apiFetch(`/v1/cards/${cardId}`, apiKey);
  expect(response.status).toBe(200);
  return (await response.json()) as ApiCard;
};

const settledStages = (card: ApiCard) =>
  Object.values(card.processingStatus ?? {}).every(
    (stage) => stage.status === "completed" || stage.status === "failed"
  );

test("a new note is classified, tagged and summarized by the card-processing workflow", async () => {
  const marker = `lighthouse${Date.now()}`;
  const created = await apiFetch("/v1/cards", apiKey, {
    method: "POST",
    body: JSON.stringify({
      content: `${marker} keepers maintain coastal beacons through winter storms`,
    }),
  });
  expect(created.status).toBe(200);
  const { cardId } = (await created.json()) as { cardId: string };

  await retry(
    async () => {
      const card = await readCard(cardId);
      expect(card.processingStatus?.metadata?.status).toBe("completed");
      expect(card.aiTags).toContain(marker.toLowerCase());
      expect(card.aiSummary).toContain(marker);
      expect(settledStages(card)).toBe(true);
    },
    { intervals: [500, 1000, 2000], timeout: 60_000 }
  );
});

test("editing a note replaces its processing run, so only the newer content is summarized", async () => {
  const created = await apiFetch("/v1/cards", apiKey, {
    method: "POST",
    body: JSON.stringify({ content: `orchard${Date.now()} pruning notes` }),
  });
  const { cardId } = (await created.json()) as { cardId: string };
  const newer = `harbor${Date.now()}`;
  const edited = await apiFetch(`/v1/cards/${cardId}`, apiKey, {
    method: "PATCH",
    body: JSON.stringify({ content: `${newer} tide tables for sailing` }),
  });
  expect(edited.status).toBe(200);

  await retry(
    async () => {
      const card = await readCard(cardId);
      expect(card.processingStatus?.metadata?.status).toBe("completed");
      expect(card.aiSummary).toContain(newer);
      expect(card.aiTags).toContain(newer.toLowerCase());
    },
    { intervals: [500, 1000, 2000], timeout: 90_000 }
  );
});

test("an export workflow builds a downloadable archive", async () => {
  const started = await apiFetch("/v1/exports", apiKey, { method: "POST" });
  expect(started.status).toBe(202);

  let downloadUrl = "";
  await retry(
    async () => {
      const latest = await apiFetch("/v1/exports/latest", apiKey);
      expect(latest.status).toBe(200);
      const { job } = (await latest.json()) as {
        job: { downloadUrl: string | null; status: string } | null;
      };
      expect(job?.status).toBe("ready");
      expect(job?.downloadUrl).toBeTruthy();
      downloadUrl = job?.downloadUrl as string;
    },
    { intervals: [1000, 2000], timeout: 120_000 }
  );

  // The signed URL is the local Core Worker's own origin.
  // nosemgrep: rules_lgpl_javascript_ssrf_rule-node-ssrf
  const archive = await fetch(downloadUrl);
  expect(archive.status).toBe(200);
  const bytes = new Uint8Array(await archive.arrayBuffer());
  // A ZIP starts with the local file header signature "PK\x03\x04".
  expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
});
