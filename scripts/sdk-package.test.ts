import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve, spawn } from "bun";

test("packed SDK installs and discovers both providers outside the monorepo", async () => {
  const artifact = mkdtempSync(join(tmpdir(), "teak-sdk-package-"));
  const consumer = join(artifact, "consumer");
  mkdirSync(consumer);
  const config = join(artifact, "empty.npmrc");
  writeFileSync(config, "");
  const run = async (command: string[], cwd: string) => {
    const child = spawn(command, {
      cwd,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NPM_CONFIG_USERCONFIG: config,
      },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 20_000,
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect({ code, output: code ? stdout + stderr : "" }).toEqual({
      code: 0,
      output: "",
    });
    return stdout;
  };
  const root = fileURLToPath(new URL("..", import.meta.url));
  const workspace = join(root, "packages/sdk");
  let tarball = process.env.TEAK_SDK_RELEASE_ARTIFACT;
  if (tarball) {
    tarball = resolve(tarball);
  } else {
    await run([process.execPath, "--no-env-file", "run", "build"], workspace);
    const packed = JSON.parse(
      await run(
        [
          "npm",
          "pack",
          "--json",
          "--ignore-scripts",
          "--pack-destination",
          artifact,
        ],
        workspace
      )
    );
    tarball = join(artifact, packed[0].filename);
  }
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: { "teak-sdk": `file:${tarball}` },
    })
  );
  await run(
    [
      "npm",
      "install",
      "--package-lock-only",
      "--ignore-scripts",
      "--audit=false",
      "--fund=false",
    ],
    consumer
  );
  await run(
    ["npm", "ci", "--ignore-scripts", "--audit=false", "--fund=false"],
    consumer
  );
  writeFileSync(
    join(consumer, "types.ts"),
    `
import { discoverAuthServer, createTeakClient, type AuthDiscovery } from "teak-sdk";
const auth: AuthDiscovery = await discoverAuthServer("https://example.com");
const client = createTeakClient({ tokenProvider: { getAccessToken: () => null } });
const surface: string = auth.clients.raycast;
void client; void surface;
`
  );
  await run(
    [
      join(root, "node_modules/.bin/tsc"),
      "types.ts",
      "--strict",
      "--noEmit",
      "--moduleResolution",
      "bundler",
      "--module",
      "esnext",
      "--target",
      "es2022",
      "--skipLibCheck",
    ],
    consumer
  );
  await run(
    [
      join(root, "node_modules/.bin/tsc"),
      "types.ts",
      "--strict",
      "--noEmit",
      "--moduleResolution",
      "nodenext",
      "--module",
      "nodenext",
      "--target",
      "es2022",
    ],
    consumer
  );
  let primary = "betterauth";
  const server = serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      const issuer = `${server.url.origin}/${primary}`;
      if (path === "/.well-known/oauth-protected-resource/mcp") {
        return Response.json({
          resource: `${server.url.origin}/mcp`,
          authorization_servers: [issuer],
        });
      }
      if (path === "/.well-known/teak-oauth-clients.json") {
        return Response.json({
          primary,
          issuer,
          clients: Object.fromEntries(
            ["cli", "raycast", "chrome", "firefox", "safari"].map((surface) => [
              surface,
              `${primary}-${surface}`,
            ])
          ),
        });
      }
      if (path === `/.well-known/oauth-authorization-server/${primary}`) {
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          revocation_endpoint: `${issuer}/revoke`,
          code_challenge_methods_supported: ["S256"],
        });
      }
      return new Response("Not found", { status: 404 });
    },
  });
  try {
    writeFileSync(
      join(consumer, "runtime.mjs"),
      `
import { discoverAuthServer } from "teak-sdk";
const auth = await discoverAuthServer(${JSON.stringify(server.url.origin)});
console.log(JSON.stringify(auth));
`
    );
    const evidence: unknown[] = [];
    for (const provider of ["betterauth", "workos"]) {
      primary = provider;
      const auth = JSON.parse(await run(["node", "runtime.mjs"], consumer));
      expect(auth.primary).toBe(provider);
      expect(auth.clients.raycast).toBe(`${provider}-raycast`);
      expect(auth.tokenEndpoint).toBe(`${server.url.origin}/${provider}/token`);
      evidence.push(auth);
    }
    writeFileSync(
      join(
        process.env.TEAK_SDK_RELEASE_ARTIFACT
          ? resolve(tarball, "..")
          : artifact,
        "proof.json"
      ),
      JSON.stringify({ tarball, evidence, typesValidated: true }, null, 2)
    );
  } finally {
    server.stop();
  }
}, 60_000);
