import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname } from "node:path";
import { NotFoundException, WorkOS } from "@workos-inc/node";
import { CLOUD_DEV_ACCOUNT_EMAIL } from "../../packages/convex/shared/devAccounts.ts";
import { TEST_SESSION_EMAIL_DOMAIN } from "./workos-test-session.ts";

export interface DevAccount {
  email: string;
  password: string;
  workosUserId: string;
}

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/\.local$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "host";

const cloudSessionId = (
  env: Record<string, string | undefined>
): string | undefined => {
  const session = env.CLAUDE_CODE_REMOTE_SESSION_ID?.trim();
  return env.CLAUDE_CODE_REMOTE === "true" && session ? session : undefined;
};

export const isCloudSession = (
  env: Record<string, string | undefined> = process.env
): boolean => cloudSessionId(env) !== undefined;

/**
 * The machine part of the account email. Every Claude Code cloud VM is named
 * "vm" and checks out "main", so a cloud session is named after a hash of its
 * session ID instead: each session gets its own account, and resuming the
 * session on a new VM signs in to the same one.
 */
export const devAccountHost = (
  env: Record<string, string | undefined> = process.env,
  host = hostname()
): string => {
  const session = cloudSessionId(env);
  if (!session) {
    return host;
  }
  const hash = createHash("sha256").update(session).digest("hex").slice(0, 8);
  return `cloud-${hash}`;
};

export const devAccountEmail = (
  namespace: string,
  host = devAccountHost()
): string =>
  `dev+${slug(host)}-${slug(namespace)}@${TEST_SESSION_EMAIL_DOMAIN}`;

const readSaved = (path: string): DevAccount | null => {
  if (!existsSync(path)) {
    return null;
  }
  try {
    const saved = JSON.parse(readFileSync(path, "utf-8")) as DevAccount;
    return saved.email && saved.password && saved.workosUserId ? saved : null;
  } catch {
    return null;
  }
};

/**
 * Find or create the account and make sure its saved password signs in.
 * WorkOS sends the backend's user.created webhook, which links the account.
 */
export const ensureDevAccount = async (options: {
  apiKey: string;
  clientId: string;
  namespace: string;
  statePath: string;
}): Promise<DevAccount> => {
  const workos = new WorkOS(options.apiKey, { clientId: options.clientId });
  const email = devAccountEmail(options.namespace);
  const saved = readSaved(options.statePath);
  if (saved?.email === email) {
    try {
      await workos.userManagement.authenticateWithPassword({
        clientId: options.clientId,
        email,
        password: saved.password,
      });
      return saved;
    } catch {}
  }
  const password = `${randomBytes(24).toString("base64url")}aA1!`;
  const existing = (await workos.userManagement.listUsers({ email })).data[0];
  const user = existing
    ? await workos.userManagement.updateUser({
        userId: existing.id,
        password,
        emailVerified: true,
      })
    : await workos.userManagement.createUser({
        email,
        password,
        emailVerified: true,
        firstName: "Teak",
        lastName: "Developer",
      });
  const account = { email, password, workosUserId: user.id };
  mkdirSync(dirname(options.statePath), { recursive: true });
  writeFileSync(options.statePath, `${JSON.stringify(account, null, 2)}\n`, {
    mode: 0o600,
  });
  return account;
};

export const STALE_CLOUD_ACCOUNT_MS = 14 * 24 * 60 * 60 * 1000;

export interface CloudAccountActivity {
  createdAt: string;
  email: string;
  lastSignInAt: string | null;
  workosUserId: string;
}

/**
 * The cloud session accounts to prune: last signed in to (or, never signed
 * in, created) more than `maxAgeMs` ago. The current session's account and
 * every address that isn't a cloud session account are always kept, and so is
 * an account whose dates don't parse.
 */
export const selectStaleCloudAccounts = (
  accounts: CloudAccountActivity[],
  options: {
    current: { email: string; workosUserId: string };
    maxAgeMs?: number;
    now: number;
  }
): CloudAccountActivity[] => {
  const maxAgeMs = options.maxAgeMs ?? STALE_CLOUD_ACCOUNT_MS;
  return accounts.filter((account) => {
    if (
      account.workosUserId === options.current.workosUserId ||
      account.email === options.current.email ||
      !CLOUD_DEV_ACCOUNT_EMAIL.test(account.email)
    ) {
      return false;
    }
    const lastActive = Date.parse(account.lastSignInAt ?? account.createdAt);
    return Number.isFinite(lastActive) && options.now - lastActive > maxAgeMs;
  });
};

/**
 * WorkOS sign-in dates for the given accounts. An account WorkOS no longer has
 * is left out, so it is never pruned from here.
 */
export const readCloudAccountActivity = async (
  options: { apiKey: string; clientId: string },
  accounts: { email: string; workosUserId: string }[]
): Promise<CloudAccountActivity[]> => {
  const workos = new WorkOS(options.apiKey, { clientId: options.clientId });
  const activity: CloudAccountActivity[] = [];
  for (const account of accounts) {
    try {
      const user = await workos.userManagement.getUser(account.workosUserId);
      if (user.email !== account.email) {
        continue;
      }
      activity.push({
        createdAt: user.createdAt,
        email: user.email,
        lastSignInAt: user.lastSignInAt,
        workosUserId: user.id,
      });
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        throw error;
      }
    }
  }
  return activity;
};
