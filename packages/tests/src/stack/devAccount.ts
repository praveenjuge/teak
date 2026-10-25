import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { api } from "@teak/convex";
import type {
  StackState,
  StackUrls,
} from "../../../../scripts/lib/stack-state.ts";
import { waitForTeakAccount } from "../../../../scripts/lib/teak-account.ts";
import { EMULATOR_API_KEY, EMULATOR_CLIENT_ID } from "./config";

// The account `bun run dev --local` signs in with: made on the WorkOS
// emulator once the stack answers, so its user.created webhook reaches the
// local backend, then seeded with the dev deployment's sample cards
// (`devSeed:seed` accepts a local backend wired to the emulator). The
// emulator keeps users in memory, so every start makes it again.

const CONVEX_DIR = join(import.meta.dir, "../../../convex");

const emulatorFetch = async (
  origin: string,
  path: string,
  body: Record<string, unknown>
) => {
  const response = await fetch(new URL(path, origin), {
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${EMULATOR_API_KEY}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`WorkOS emulator POST ${path}: ${response.status}`);
  }
  return response.json() as Promise<Record<string, unknown>>;
};

export const localDevEmail = (namespace: string) =>
  `dev+local-${namespace.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}@example.org`;

export const seedLocalDevAccount = async (
  urls: StackUrls,
  namespace: string,
  env: NodeJS.ProcessEnv
): Promise<Pick<StackState, "account" | "notes">> => {
  const origin = urls.emulatorOrigin;
  if (!origin) {
    throw new Error("The local stack has no WorkOS emulator");
  }
  const account = {
    email: localDevEmail(namespace),
    password: `Teak-${randomBytes(12).toString("base64url")}1!`,
  };
  const user = await emulatorFetch(origin, "/user_management/users", {
    email: account.email,
    email_verified: true,
    first_name: "Teak",
    last_name: "Dev",
    password: account.password,
  });
  const session = await emulatorFetch(origin, "/user_management/authenticate", {
    client_id: EMULATOR_CLIENT_ID,
    client_secret: EMULATOR_API_KEY,
    email: account.email,
    grant_type: "password",
    password: account.password,
  });
  const { client } = await waitForTeakAccount({
    accessToken: String(session.access_token),
    convexUrl: urls.convexUrl,
  });
  const seeded = spawnSync(
    "bunx",
    [
      "convex",
      "run",
      "devSeed:seed",
      JSON.stringify({ workosUserId: user.id }),
    ],
    { cwd: CONVEX_DIR, encoding: "utf-8", env, timeout: 60_000 }
  );
  const vault =
    seeded.status === 0
      ? "its vault is seeded with sample cards"
      : `seeding skipped (${seeded.stderr.trim().split("\n").at(-1)})`;
  // The stack warms the modules the app reads first without auth; a signed-in
  // first read still loads more of them, which can outlast the 1 s query limit
  // on a busy VM while Next.js compiles the page. Do that read here.
  for (let round = 0; round < 2; round += 1) {
    await Promise.allSettled([
      client.query(api.auth.getAuthUser, {}),
      client.query(api.cards.searchCardsPaginated, {
        paginationOpts: { cursor: null, numItems: 30 },
      }),
    ]);
  }
  return {
    account,
    notes: [
      `Sign in as ${account.email} / ${account.password} (WorkOS emulator); ${vault}.`,
      "Local backend, WorkOS emulator and Files Worker in Miniflare; Convex pushes this checkout's backend as you edit it.",
    ],
  };
};
