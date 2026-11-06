import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  legacyApiRedirects,
  mcpChallenge,
  surfaces,
} from "@teak/scripts/dev/production-surfaces";
import { published } from "../helpers/env";
import { expect, test } from "../helpers/test";

const contentType = {
  html: /text\/html/,
  json: /application\/json/,
  text: /text\/plain/,
} as const;

// The suite retries a failed test once (e2e.docs.config.ts), which covers a
// network blip; the requests themselves don't retry.
for (const [index, probe] of surfaces(
  published.siteUrl,
  published.appUrl
).entries()) {
  const prefix = `extra-${String(index + 1).padStart(3, "0")} ${probe.name}`;

  test(`${prefix} production response contract`, async () => {
    const response = await fetch(probe.url);
    const body = await response.text();

    expect(response.status, "status is successful").toBeLessThan(400);
    expect(
      response.headers.get("content-type") ?? "",
      "content type is stable"
    ).toMatch(contentType[probe.kind]);
    expect(
      response.headers.get("strict-transport-security") ?? "",
      "security headers are present"
    ).toContain("max-age");
    expect(
      response.headers.get("x-content-type-options") ?? "",
      "security headers are present"
    ).toBe("nosniff");
    expect(body, "body contains expected product marker").toMatch(probe.body);
    expect(body, "body has no obvious server error leak").not.toMatch(
      /Unhandled Runtime Error|Internal Server Error|stack trace/i
    );
  });
}

for (const { from, to } of legacyApiRedirects()) {
  test(`extra legacy API ${new URL(from).pathname} redirects permanently`, async () => {
    const response = await fetch(from, { redirect: "manual" });
    expect(response.status, "308 keeps the method").toBe(308);
    expect(response.headers.get("location")).toBe(to);
  });
}

test("extra MCP challenges an unauthenticated request", async () => {
  const challenge = mcpChallenge(published.siteUrl);
  const response = await fetch(challenge.url, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(challenge.body),
  });
  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate") ?? "").toContain(
    challenge.metadata
  );
});

interface AmoAddon {
  current_version?: { version: string };
  guid: string;
  slug: string;
  status: string;
}

// The listing page answers scripted requests with a bot challenge, so this
// reads AMO's public API. It answers 401 until the add-on has a public version.
test("extra Firefox add-on is listed on AMO at the slug the docs link to", async () => {
  const response = await fetch(
    "https://addons.mozilla.org/api/v5/addons/addon/teak/"
  );
  expect(response.status, "the listing is public").toBe(200);
  const addon = (await response.json()) as AmoAddon;
  expect(addon.guid).toBe("teak@teakvault.com");
  expect(addon.slug).toBe("teak");
  expect(addon.status).toBe("public");
  expect(addon.current_version?.version ?? "").toMatch(/^\d+\.\d+\.\d+$/);
});

interface SkillsIndex {
  skills: { digest: string; name: string; type: string; url: string }[];
}

const sha256 = (bytes: ArrayBuffer | Buffer) =>
  `sha256:${createHash("sha256")
    .update(new Uint8Array(bytes as ArrayBuffer))
    .digest("hex")}`;

test("extra agent skills index matches what it serves and this checkout", async () => {
  const indexUrl = `${published.siteUrl}/.well-known/agent-skills/index.json`;
  const response = await fetch(indexUrl);
  expect(
    response.headers.get("access-control-allow-origin"),
    "any agent can read the index"
  ).toBe("*");
  const index = (await response.json()) as SkillsIndex;
  expect(index.skills.map((skill) => skill.name)).toContain("teak");
  for (const skill of index.skills) {
    const artifact = await fetch(new URL(skill.url, indexUrl).toString());
    expect(artifact.status, `${skill.name} artifact is served`).toBe(200);
    expect(
      artifact.headers.get("access-control-allow-origin"),
      `${skill.name} artifact is readable cross-origin`
    ).toBe("*");
    expect(
      sha256(await artifact.arrayBuffer()),
      `${skill.name} digest matches the served file`
    ).toBe(skill.digest);
  }
  const teak = index.skills.find((skill) => skill.name === "teak");
  const local = readFileSync(
    new URL("../../../../.agents/skills/teak/SKILL.md", import.meta.url)
  );
  expect(teak?.type).toBe("skill-md");
  expect(teak?.digest, "teak digest matches .agents/skills/teak").toBe(
    sha256(local)
  );
});
