import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const devUrl = "https://reminiscent-kangaroo-59.convex.cloud";

async function loadConfig(cloudUrl: string, clientId?: string) {
  // Convex auth configuration throws when it reads an unset variable, unlike
  // ordinary Node environment access. Exercise that boundary in a fresh process.
  const script = `
    const values = {
      CONVEX_CLOUD_URL: ${JSON.stringify(cloudUrl)},
      CONVEX_SITE_URL: "https://isolated-test.convex.site",
      JWKS: "null",
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

test.each([
  "https://production.convex.cloud",
  "http://127.0.0.1:3210",
  "https://another-dev.convex.cloud",
])(
  "deploys Better Auth without WorkOS configuration on %s",
  async (url: string) => {
    const config = await loadConfig(url);
    expect(config.providers).toHaveLength(1);
    expect(config.providers[0]?.issuer).toBe(
      "https://isolated-test.convex.site"
    );
  }
);

test("trusts the exact provisioned AuthKit client on the readiness deployment", async () => {
  const client = "client_01KBYSVNVDV2G39REZFGF0K7GD";
  const config = await loadConfig(devUrl, client);
  expect(config.providers).toHaveLength(2);
  expect(config.providers[1]).toMatchObject({
    issuer: `https://api.workos.com/user_management/${client}`,
    jwks: `https://api.workos.com/sso/jwks/${client}`,
  });
});
