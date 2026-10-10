/**
 * The WorkOS staging account `bun run dev` signs in with: one per machine and
 * checkout (dev+<host>-<namespace>@example.org), so parallel checkouts on the
 * shared dev deployment never share a vault. Its password is random and kept
 * in the checkout's ignored .agents/.state/dev-account.json; when that file is
 * gone, the password is reset. Nothing here logs the password.
 */

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname } from "node:path";
import { WorkOS } from "@workos-inc/node";
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

export const devAccountEmail = (namespace: string, host = hostname()): string =>
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
    } catch {
      // Deleted or changed in WorkOS; set it up again below.
    }
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
