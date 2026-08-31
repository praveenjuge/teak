import { expect, test } from "@playwright/test";
import { apiFetch, perfSummary } from "../helpers/api";
import { env } from "../helpers/env";
import { requireAccount } from "../helpers/run-state";

test("deleted account credentials are inert", async () => {
  const primary = requireAccount("account");
  if (!primary.apiKey) {
    throw new Error("Missing account lifecycle API key");
  }
  expect((await apiFetch("/v1/tags", primary.apiKey)).status).toBe(401);
  expect(
    (
      await fetch(env.mcpUrl, {
        headers: { Authorization: `Bearer ${primary.apiKey}` },
      })
    ).status
  ).toBe(401);
  perfSummary();
});
