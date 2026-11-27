import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "../../_generated/api";
import { DOWNLOAD_URL_TTL_SECONDS } from "../../export/constants";
import { buildR2UserPrefix } from "../../storage/r2";
import { newBackend, signIn } from "../helpers.testUtils";

const OWNER = "export-link-owner";
const NOW = Date.UTC(2026, 10, 26, 10, 7);
const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("FILES_BASE", "https://files.test");
  vi.stubEnv("FILES_SIGNING_SECRET", "test-secret");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

test("an export's download link stops working when it says it expires", async () => {
  const t = newBackend();
  const owner = await signIn(t, OWNER);
  const jobId = await t.run((ctx) =>
    ctx.db.insert("exportJobs", {
      userId: OWNER,
      status: "ready",
      cancelRequested: false,
      artifactKey: `${buildR2UserPrefix(OWNER)}/exports/teak-export.zip`,
      quotaCountedAt: NOW - 1000,
      completedAt: NOW - 1000,
      expiresAt: NOW + 7 * DAY_MS,
      createdAt: NOW - 1000,
      updatedAt: NOW - 1000,
    })
  );

  const link = await owner.action(api.dataExport.getExportDownloadUrl, {
    jobId,
  });

  expect(link?.expiresInSeconds).toBe(DOWNLOAD_URL_TTL_SECONDS);
  // The Core Worker honors whatever `exp` the link was signed with.
  const exp = Number(new URL(link?.url ?? "").searchParams.get("exp"));
  expect(exp).toBe(Math.floor(NOW / 1000) + DOWNLOAD_URL_TTL_SECONDS);
});
