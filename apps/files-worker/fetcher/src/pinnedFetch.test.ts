import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPinnedFetch,
  orderPinnedAddresses,
  pinnedAttempts,
} from "./pinnedFetch";

describe("pinnedFetch", () => {
  test("prefers validated IPv4 addresses before IPv6 fallbacks", () => {
    expect(
      orderPinnedAddresses([
        "2606:2800:220:1:248:1893:25c8:1946",
        "93.184.216.34",
        "2606:2800:220:1:248:1893:25c8:1947",
        "93.184.216.35",
      ])
    ).toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "93.184.216.35", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
      { address: "2606:2800:220:1:248:1893:25c8:1947", family: 6 },
    ]);
  });

  test("connects to each checked address while naming the original host", () => {
    expect(
      pinnedAttempts("https://example.com/a/b?c=1#frag", [
        "2606:2800:220:1:248:1893:25c8:1946",
        "93.184.216.34",
      ])
    ).toEqual([
      {
        host: "example.com",
        serverName: "example.com",
        target: "https://93.184.216.34/a/b?c=1",
      },
      {
        host: "example.com",
        serverName: "example.com",
        target: "https://[2606:2800:220:1:248:1893:25c8:1946]/a/b?c=1",
      },
    ]);
  });

  test("keeps a non-default port in Host and sends no SNI over plain HTTP", () => {
    expect(
      pinnedAttempts("http://example.com:8080/x", ["93.184.216.34"])
    ).toEqual([
      { host: "example.com:8080", target: "http://93.184.216.34:8080/x" },
    ]);
  });

  test("an IP literal URL connects to that literal only", () => {
    expect(
      pinnedAttempts("https://[2606:4700::1]/x", ["93.184.216.34"])
    ).toEqual([{ host: "[2606:4700::1]", target: "https://[2606:4700::1]/x" }]);
  });
});

// The rest drives Bun's real fetch against a local TLS server whose
// certificate names only `pinned.test`, a name that never resolves.
const openssl = Bun.which("openssl");

const run = (args: string[], cwd: string) => {
  const result = Bun.spawnSync([openssl as string, ...args], { cwd });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString());
  }
};

/** A throwaway CA and a `pinned.test` leaf it signed. */
const makeCertificates = (dir: string) => {
  writeFileSync(
    join(dir, "ca.cnf"),
    "[req]\ndistinguished_name=dn\nprompt=no\n[dn]\nCN=Pinned Test CA\n[ext]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign\n"
  );
  writeFileSync(
    join(dir, "leaf.ext"),
    "basicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:pinned.test\n"
  );
  run(
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-config",
      "ca.cnf",
      "-extensions",
      "ext",
      "-keyout",
      "ca.key",
      "-out",
      "ca.pem",
    ],
    dir
  );
  run(
    [
      "req",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-subj",
      "/CN=pinned.test",
      "-keyout",
      "leaf.key",
      "-out",
      "leaf.csr",
    ],
    dir
  );
  run(
    [
      "x509",
      "-req",
      "-in",
      "leaf.csr",
      "-CA",
      "ca.pem",
      "-CAkey",
      "ca.key",
      "-CAcreateserial",
      "-days",
      "1",
      "-extfile",
      "leaf.ext",
      "-out",
      "leaf.pem",
    ],
    dir
  );
  const read = (name: string) => readFileSync(join(dir, name), "utf8");
  return { ca: read("ca.pem"), cert: read("leaf.pem"), key: read("leaf.key") };
};

describe.skipIf(!openssl)("pinnedFetch over the network", () => {
  let dir = "";
  let ca = "";
  let tlsServer: ReturnType<typeof Bun.serve>;
  let plainServer: ReturnType<typeof Bun.serve>;

  const echo = (request: Request) => {
    const url = new URL(request.url);
    if (url.pathname === "/redirect") {
      return new Response("moved", {
        headers: { location: "/elsewhere" },
        status: 302,
      });
    }
    return Response.json({
      host: request.headers.get("host"),
      path: `${url.pathname}${url.search}`,
    });
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "teak-pinned-"));
    const certificates = makeCertificates(dir);
    ca = certificates.ca;
    tlsServer = Bun.serve({
      fetch: echo,
      hostname: "127.0.0.1",
      port: 0,
      tls: { cert: certificates.cert, key: certificates.key },
    });
    plainServer = Bun.serve({ fetch: echo, hostname: "127.0.0.1", port: 0 });
  });

  afterAll(() => {
    tlsServer?.stop(true);
    plainServer?.stop(true);
    if (dir) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  const get = (url: string, addresses: string[], init: RequestInit = {}) =>
    createPinnedFetch({ ca })(url, addresses, init);

  test("connects to the checked address and verifies the certificate against the hostname", async () => {
    const response = await get(
      `https://pinned.test:${tlsServer.port}/page?q=1`,
      ["127.0.0.1"],
      { headers: { host: "attacker.example", "user-agent": "teak" } }
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      host: `pinned.test:${tlsServer.port}`,
      path: "/page?q=1",
    });
  });

  test("rejects a certificate that does not name the URL's host", async () => {
    await expect(
      get(`https://other.test:${tlsServer.port}/`, ["127.0.0.1"])
    ).rejects.toThrow();
  });

  test("rejects a certificate the default roots do not trust", async () => {
    await expect(
      createPinnedFetch()(
        `https://pinned.test:${tlsServer.port}/`,
        ["127.0.0.1"],
        {}
      )
    ).rejects.toThrow();
  });

  test("keeps verifying when NODE_TLS_REJECT_UNAUTHORIZED is 0", async () => {
    const saved = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    try {
      await expect(
        get(`https://other.test:${tlsServer.port}/`, ["127.0.0.1"])
      ).rejects.toThrow();
      await expect(
        createPinnedFetch()(
          `https://pinned.test:${tlsServer.port}/`,
          ["127.0.0.1"],
          {}
        )
      ).rejects.toThrow();
    } finally {
      if (saved === undefined) {
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      } else {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = saved;
      }
    }
  });

  test("ignores the proxy environment", async () => {
    const saved = {
      HTTPS_PROXY: process.env.HTTPS_PROXY,
      https_proxy: process.env.https_proxy,
      NO_PROXY: process.env.NO_PROXY,
      no_proxy: process.env.no_proxy,
    };
    process.env.HTTPS_PROXY = "http://127.0.0.1:1";
    process.env.https_proxy = "http://127.0.0.1:1";
    process.env.NO_PROXY = "";
    process.env.no_proxy = "";
    try {
      const response = await get(`https://pinned.test:${tlsServer.port}/`, [
        "127.0.0.1",
      ]);
      expect(response.status).toBe(200);
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    }
  });

  test("returns a redirect unfollowed, even when asked to follow it", async () => {
    const response = await get(
      `https://pinned.test:${tlsServer.port}/redirect`,
      ["127.0.0.1"],
      { redirect: "follow" }
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/elsewhere");
  });

  test("sends the original Host over plain HTTP", async () => {
    const response = await get(`http://pinned.test:${plainServer.port}/x`, [
      "127.0.0.1",
    ]);
    expect(await response.json()).toEqual({
      host: `pinned.test:${plainServer.port}`,
      path: "/x",
    });
  });

  test("tries the next checked address when one refuses the connection", async () => {
    // Nothing listens on 127.0.0.2; the server is bound to 127.0.0.1.
    const response = await get(`https://pinned.test:${tlsServer.port}/`, [
      "127.0.0.2",
      "127.0.0.1",
    ]);
    expect(response.status).toBe(200);
  });

  test("tries only the first address for a method that is not idempotent", async () => {
    await expect(
      get(
        `https://pinned.test:${tlsServer.port}/`,
        ["127.0.0.2", "127.0.0.1"],
        {
          method: "POST",
        }
      )
    ).rejects.toThrow();
  });

  test("stops at an aborted request instead of trying another address", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      get(`https://pinned.test:${tlsServer.port}/`, ["127.0.0.1"], {
        signal: controller.signal,
      })
    ).rejects.toThrow();
  });
});
