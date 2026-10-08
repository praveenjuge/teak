import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

async function loadConfig(clientId?: string) {
  // Convex auth configuration throws when it reads an unset variable, unlike
  // ordinary Node environment access. Exercise that boundary in a fresh process.
  const script = `
    const values = {
      ${clientId ? `WORKOS_CLIENT_ID: ${JSON.stringify(clientId)},` : ""}
    };
    process.env = new Proxy(values, {
      get(target, name) {
        if (typeof name === "string" && name.startsWith("WORKOS_") && !(name in target)) {
          throw new Error("Unset auth configuration variable: " + name);
        }
        return target[name];
      }
    });
    const { default: config } = await import("./auth.config.ts");
    console.log(JSON.stringify(config));
  `;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ["--eval", script],
    {
      cwd: new URL("..", import.meta.url).pathname,
    }
  );
  return JSON.parse(stdout) as {
    providers: { issuer?: string; jwks?: string }[];
  };
}

test("trusts only the configured AuthKit client", async () => {
  const client = "client_01KBYSVNVDV2G39REZFGF0K7GD";
  const config = await loadConfig(client);
  expect(config.providers).toEqual([
    {
      type: "customJwt",
      issuer: `https://api.workos.com/user_management/${client}`,
      algorithm: "RS256",
      jwks: `https://api.workos.com/sso/jwks/${client}`,
    },
  ]);
});

test("a deployment without a WorkOS client fails to load", async () => {
  await expect(loadConfig()).rejects.toThrow("WORKOS_CLIENT_ID");
});

test("rejects a value that is not a WorkOS client ID", async () => {
  await expect(loadConfig("https://evil.example")).rejects.toThrow(
    "must be a WorkOS client ID"
  );
});
