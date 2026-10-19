#!/usr/bin/env bun
/**
 * Mints or revokes an API key for the running dev stack's seeded account, so
 * the API, CLI and MCP recipes run without a browser. It signs in to WorkOS
 * staging with the account in .agents/.state/stack.json and calls the same
 * mutations Settings → Security → API keys does. The key goes to the ignored
 * .agents/.state/verify/api-key.json (owner-only); stdout shows only its
 * masked prefix. Creating keys through Settings is itself a feature to
 * verify: use the browser recipe for that, and this helper for everything
 * that just needs a key.
 *
 * Usage:
 *   bun .agents/skills/verify-teak/scripts/api-key.ts mint
 *   bun .agents/skills/verify-teak/scripts/api-key.ts check    # 200 or 401
 *   bun .agents/skills/verify-teak/scripts/api-key.ts revoke   # also clears a key revoked in Settings
 * Then: export TEAK_API_KEY="$(jq -r .key .agents/.state/verify/api-key.json)"
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { WorkOS } from "@workos-inc/node";
import { api } from "../../../../packages/convex/_generated/api.js";
import { loadTargetEnv } from "../../../../scripts/env-loader.ts";
import {
  isStackRunning,
  readStackState,
} from "../../../../scripts/lib/stack-state.ts";
import { waitForTeakAccount } from "../../../../scripts/lib/teak-account.ts";
import { describeWorkosError } from "../../../../scripts/lib/workos-test-session.ts";

const ROOT = join(import.meta.dir, "../../../..");
const KEY_PATH = join(ROOT, ".agents/.state/verify/api-key.json");

const fail = (message: string): never => {
  console.error(`api-key: ${message}`);
  process.exit(1);
};

const signIn = async () => {
  const state = readStackState(ROOT);
  if (!(state && isStackRunning(state) && state.ready)) {
    return fail(
      "the dev stack isn't running; start it with `bun run dev --detach`"
    );
  }
  if (state.mode !== "dev" || !state.account) {
    return fail(
      "only the dev stack's seeded account is supported; on the E2E stack, create keys in Settings"
    );
  }
  const env = loadTargetEnv("web").values;
  const apiKey = env.get("WORKOS_API_KEY") ?? "";
  const clientId = env.get("WORKOS_CLIENT_ID") ?? "";
  let accessToken: string;
  try {
    ({ accessToken } = await new WorkOS(apiKey, {
      clientId,
    }).userManagement.authenticateWithPassword({
      clientId,
      email: state.account.email,
      password: state.account.password,
    }));
  } catch (error) {
    return fail(`WorkOS sign-in failed (${describeWorkosError(error)})`);
  }
  const { client } = await waitForTeakAccount({
    accessToken,
    convexUrl: state.urls.convexUrl,
  });
  return { client, apiUrl: state.urls.apiOrigin };
};

const mint = async () => {
  if (existsSync(KEY_PATH)) {
    return fail(`${KEY_PATH} already holds a key; revoke it first`);
  }
  const { client, apiUrl } = await signIn();
  const created = await client.mutation(api.apiKeys.createUserApiKey, {
    name: "verify-teak",
  });
  mkdirSync(dirname(KEY_PATH), { recursive: true });
  writeFileSync(
    KEY_PATH,
    `${JSON.stringify({ id: created.id, key: created.key, apiUrl }, null, 2)}\n`,
    { mode: 0o600 }
  );
  console.log(`api-key: minted ${created.keyPrefix}_•••• for ${apiUrl}`);
  console.log(`api-key: saved to ${KEY_PATH}`);
};

interface SavedKey {
  apiUrl: string;
  id: string;
  key: string;
}

const readSaved = (): SavedKey => {
  if (!existsSync(KEY_PATH)) {
    return fail(`no key at ${KEY_PATH}`);
  }
  return JSON.parse(readFileSync(KEY_PATH, "utf-8")) as SavedKey;
};

/**
 * Whether a GET /v1/me answer means the key itself is revoked. Only the
 * API's INVALID_API_KEY code says so; any other 401 leaves the key live.
 */
export const isRevokedKeyAnswer = (status: number, body: unknown): boolean =>
  status === 401 &&
  typeof body === "object" &&
  body !== null &&
  (body as { code?: unknown }).code === "INVALID_API_KEY";

// GET /v1/me with the saved key: 200 while it works, 401 INVALID_API_KEY once
// it is revoked. The key never leaves this process.
const askMe = async (
  saved: SavedKey
): Promise<{ revoked: boolean; status: number }> => {
  const response = await fetch(`${saved.apiUrl}/v1/me`, {
    headers: { Authorization: `Bearer ${saved.key}` },
    signal: AbortSignal.timeout(30_000),
  });
  const body: unknown = await response.json().catch(() => null);
  return {
    revoked: isRevokedKeyAnswer(response.status, body),
    status: response.status,
  };
};

const check = async () => {
  const { revoked, status } = await askMe(readSaved());
  console.log(
    `api-key: GET /v1/me answered ${status}${revoked ? " (key revoked)" : ""}`
  );
};

const revoke = async () => {
  const saved = readSaved();
  if ((await askMe(saved)).revoked) {
    rmSync(KEY_PATH);
    console.log("api-key: already revoked; removed the saved key");
    return;
  }
  const { client } = await signIn();
  await client.mutation(api.apiKeys.revokeUserApiKey, { keyId: saved.id });
  rmSync(KEY_PATH);
  console.log("api-key: revoked and removed the saved key");
};

if (import.meta.main) {
  const command = process.argv[2];
  if (command === "mint") {
    await mint();
  } else if (command === "check") {
    await check();
  } else if (command === "revoke") {
    await revoke();
  } else {
    fail("usage: api-key.ts mint | check | revoke");
  }
}
