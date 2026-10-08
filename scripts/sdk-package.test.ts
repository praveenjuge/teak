import { expect, test } from "bun:test";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve, spawn } from "bun";
import { readArtifact } from "./sdk-release.mjs";

test("packed SDK installs and discovers both providers outside the monorepo", async () => {
  const artifact = mkdtempSync(join(tmpdir(), "teak-sdk-package-"));
  const consumer = join(artifact, "consumer");
  mkdirSync(consumer);
  const config = join(artifact, "empty.npmrc");
  writeFileSync(config, "");
  const run = async (
    command: string[],
    cwd: string,
    extraEnv: Record<string, string> = {}
  ) => {
    const child = spawn(command, {
      cwd,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NPM_CONFIG_USERCONFIG: config,
        ...extraEnv,
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
    const packed = await run(
      [
        "npm",
        "pack",
        "--json",
        "--ignore-scripts",
        "--pack-destination",
        artifact,
      ],
      workspace
    );
    const metadataPath = join(artifact, "pack.json");
    writeFileSync(metadataPath, packed);
    tarball = join(artifact, readArtifact(metadataPath).filename);
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
  const server = serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      const issuer = `${server.url.origin}/workos`;
      if (path === "/.well-known/oauth-protected-resource/mcp") {
        return Response.json({
          resource: "https://teakvault.com/mcp",
          authorization_servers: [issuer],
        });
      }
      if (path === "/.well-known/teak-oauth-clients.json") {
        return Response.json({
          primary: "workos",
          issuer,
          clients: Object.fromEntries(
            ["cli", "raycast", "chrome", "firefox", "safari"].map((surface) => [
              surface,
              `client_${surface.toUpperCase()}`,
            ])
          ),
        });
      }
      if (path === "/.well-known/oauth-authorization-server/workos") {
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
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
    const auth = JSON.parse(await run(["node", "runtime.mjs"], consumer));
    expect(auth.primary).toBe("workos");
    expect(auth.clients.raycast).toBe("client_RAYCAST");
    expect(auth.tokenEndpoint).toBe(`${server.url.origin}/workos/token`);
    const evidence = [auth];
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
  if (!process.env.TEAK_SDK_RELEASE_ARTIFACT) {
    const providedDirectory = join(artifact, "provided-artifact");
    mkdirSync(providedDirectory);
    const providedTarball = join(providedDirectory, "teak-sdk.tgz");
    copyFileSync(tarball, providedTarball);
    await run(
      [
        process.execPath,
        "--no-env-file",
        "test",
        "scripts/sdk-package.test.ts",
      ],
      root,
      {
        TEAK_SDK_RELEASE_ARTIFACT: providedTarball,
      }
    );
    const proof = JSON.parse(
      readFileSync(join(providedDirectory, "proof.json"), "utf8")
    );
    expect(proof.tarball).toBe(providedTarball);
    expect(proof.typesValidated).toBe(true);
    expect(
      proof.evidence.map((entry: { primary: string }) => entry.primary)
    ).toEqual(["workos"]);
  }
}, 60_000);
