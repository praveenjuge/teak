import { describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  accessToken,
  genericReleaseNotes,
  limits,
  loadConfig,
  playClient,
  publish,
  readProof,
  releaseNotesFor,
  sha256,
  signedAssertion,
  uploadSession,
  versionCodeFor,
} from "./play-publish.ts";

const repoRoot = path.resolve(import.meta.dir, "../..");
const config = loadConfig(repoRoot);
const imageHashes = Object.fromEntries(
  config.imageSets.map(({ type, files }) => [
    type,
    files.map((file) => ({ id: file, sha256: sha256(fs.readFileSync(file)) })),
  ])
);

/** An in-memory Play app behind fetch, recording every call. */
function fakePlay({
  production = [],
  bundles = [],
  listing = config.listing,
  images = imageHashes,
} = {}) {
  const state = {
    tracks: { production, internal: [] },
    bundles: [...bundles],
    listing: { ...listing },
    images: structuredClone(images),
    calls: [],
    committed: [],
    deleted: [],
  };
  let edits = 0;
  const json = (body, status = 200, headers = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });
  const respond = (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const route = url.pathname.replace(
      /^\/(upload\/)?androidpublisher\/v3\/applications\/com\.praveenjuge\.teak\//,
      ""
    );
    state.calls.push(`${method} ${route}${url.search}`);
    if (url.hostname === "upload.session.googleapis.com") {
      const target = url.searchParams.get("target");
      if (target === "bundles") {
        state.bundles.push({ versionCode: 1_000_093, sha256: "abc" });
        return json({ versionCode: 1_000_093, sha256: "abc" });
      }
      return json({ deobfuscationFile: { symbolType: "proguard" } });
    }
    if (url.searchParams.get("uploadType") === "resumable") {
      const target = route.endsWith("/bundles") ? "bundles" : "mapping";
      return new Response(null, {
        status: 200,
        headers: {
          location: `https://upload.session.googleapis.com/s?target=${target}`,
        },
      });
    }
    if (method === "POST" && route === "edits") {
      edits += 1;
      return json({ id: `edit-${edits}` });
    }
    const [, edit, rest = ""] = /^edits\/([^/:]+)(.*)$/.exec(route) ?? [];
    if (method === "DELETE" && rest === "") {
      state.deleted.push(edit);
      return json({});
    }
    if (rest === ":validate") {
      return json({ id: edit });
    }
    if (rest === ":commit") {
      state.committed.push({
        edit,
        behavior: url.searchParams.get("changesInReviewBehavior"),
      });
      return json({ id: edit });
    }
    if (rest === "/bundles") {
      return json({
        bundles: state.bundles,
      });
    }
    const track = /^\/tracks\/(\w+)$/.exec(rest)?.[1];
    if (track) {
      if (method === "PUT") {
        state.tracks[track] = JSON.parse(init.body).releases;
      }
      return json({ track, releases: state.tracks[track] });
    }
    if (rest === "/listings/en-US") {
      if (method === "PATCH") {
        state.listing = JSON.parse(init.body);
      }
      return json(state.listing);
    }
    const imageType = /^\/listings\/en-US\/(\w+)$/.exec(rest)?.[1];
    if (imageType) {
      if (method === "DELETE") {
        state.images[imageType] = [];
        return json({});
      }
      if (method === "POST") {
        state.images[imageType].push({ sha256: "uploaded" });
        return json({ image: {} });
      }
      return json({ images: state.images[imageType] });
    }
    return json(
      { error: { message: `No fake route for ${method} ${route}` } },
      404
    );
  };
  const fetch = (input, init) => Promise.resolve(respond(input, init));
  return {
    state,
    client: playClient({ token: "t", packageName: config.packageName, fetch }),
  };
}

const run = (client, overrides = {}) =>
  publish({
    client,
    config,
    version: "1.0.93",
    bundle: Buffer.from("aab"),
    mapping: Buffer.from("map"),
    releaseNotes: "Notes",
    dryRun: false,
    log: () => undefined,
    ...overrides,
  });

describe("Play store config", () => {
  test("the committed config fits Play's limits and every image exists", () => {
    expect(config.packageName).toBe("com.praveenjuge.teak");
    for (const field of ["title", "shortDescription", "fullDescription"]) {
      expect(config.listing[field].length).toBeLessThanOrEqual(limits[field]);
    }
    expect(config.imageSets.map(({ type }) => type)).toEqual([
      "icon",
      "featureGraphic",
      "phoneScreenshots",
    ]);
  });

  test("release notes: the run's override, then whatsNew, then the generic note", () => {
    expect(releaseNotesFor(" Run note ", { whatsNew: "Config" })).toBe(
      "Run note"
    );
    expect(releaseNotesFor("", { whatsNew: " Config " })).toBe("Config");
    expect(releaseNotesFor(undefined, { whatsNew: "  " })).toBe(
      genericReleaseNotes
    );
    expect(() => releaseNotesFor("x".repeat(501), {})).toThrow(
      "Play allows 500"
    );
  });

  test("version codes match the Gradle build", () => {
    expect(versionCodeFor("1.0.93")).toBe(1_000_093);
    expect(versionCodeFor("2.3.4")).toBe(2_003_004);
  });
});

describe("Play publish", () => {
  test("uploads, points both tracks at the version, and commits replacing any review", async () => {
    const play = fakePlay({
      production: [{ status: "completed", versionCodes: ["1000092"] }],
    });
    const result = await run(play.client);
    expect(result.committed).toBe(true);
    expect(play.state.committed).toEqual([
      { edit: "edit-1", behavior: "CANCEL_IN_REVIEW_AND_SUBMIT" },
    ]);
    for (const track of ["internal", "production"]) {
      expect(play.state.tracks[track]).toEqual([
        {
          name: "1.0.93",
          versionCodes: ["1000093"],
          status: "completed",
          releaseNotes: [{ language: "en-US", text: "Notes" }],
        },
      ]);
    }
    expect(play.state.calls).toContain(
      "POST edits/edit-1/apks/1000093/deobfuscationFiles/proguard?uploadType=resumable"
    );
    expect(play.state.deleted).toEqual([]);
  });

  test("never moves production backwards on a rerun of an older tag", async () => {
    const play = fakePlay({
      production: [{ status: "completed", versionCodes: ["1000094"] }],
    });
    const result = await run(play.client);
    expect(result).toMatchObject({
      skipped: true,
      productionVersionCode: 1_000_094,
    });
    expect(play.state.committed).toEqual([]);
    expect(play.state.deleted).toEqual(["edit-1"]);
    expect(play.state.calls.some((call) => call.includes("uploadType"))).toBe(
      false
    );
  });

  test("ignores a draft on production when guarding", async () => {
    const play = fakePlay({
      production: [{ status: "draft", versionCodes: ["1000099"] }],
    });
    expect((await run(play.client)).committed).toBe(true);
  });

  test("reuses a bundle a failed run already uploaded", async () => {
    const play = fakePlay({
      bundles: [{ versionCode: 1_000_093, sha256: sha256(Buffer.from("aab")) }],
    });
    await run(play.client);
    expect(play.state.calls).not.toContain(
      "POST edits/edit-1/bundles?uploadType=resumable"
    );
  });

  test("refuses a different bundle Play already has for the version code", async () => {
    const play = fakePlay({
      bundles: [{ versionCode: 1_000_093, sha256: "someone-elses-build" }],
    });
    await expect(run(play.client)).rejects.toThrow(
      "different bundle with version code 1000093"
    );
    expect(play.state.calls.some((call) => call.includes("proguard"))).toBe(
      false
    );
    expect(play.state.committed).toEqual([]);
  });

  test("a dry run checks everything even when production has the version", async () => {
    const play = fakePlay({
      production: [{ status: "completed", versionCodes: ["1000093"] }],
      bundles: [{ versionCode: 1_000_093, sha256: sha256(Buffer.from("aab")) }],
    });
    const result = await run(play.client, { dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(play.state.calls).toContain("POST edits/edit-1:validate");
    expect(play.state.committed).toEqual([]);
  });

  test("leaves unchanged listing text and images alone", async () => {
    const play = fakePlay();
    const result = await run(play.client);
    expect(result.listingChanges).toEqual([]);
    expect(Object.values(result.images)).toEqual([
      "unchanged",
      "unchanged",
      "unchanged",
    ]);
    expect(play.state.calls.some((call) => call.startsWith("PATCH"))).toBe(
      false
    );
    expect(
      play.state.calls.some((call) =>
        call.startsWith("DELETE edits/edit-1/listings")
      )
    ).toBe(false);
  });

  test("replaces changed listing text and a changed image set", async () => {
    const play = fakePlay({
      listing: { ...config.listing, title: "Old title" },
      images: { ...imageHashes, phoneScreenshots: [{ sha256: "old" }] },
    });
    const result = await run(play.client);
    expect(result.listingChanges).toEqual(["title"]);
    expect(play.state.listing.title).toBe(config.listing.title);
    expect(result.images.phoneScreenshots).toBe("replaced");
    expect(play.state.images.phoneScreenshots).toHaveLength(5);
  });

  test("a dry run validates and throws the edit away without committing", async () => {
    const play = fakePlay();
    const result = await run(play.client, { dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(play.state.calls).toContain("POST edits/edit-1:validate");
    expect(play.state.committed).toEqual([]);
    expect(play.state.deleted).toEqual(["edit-1"]);
  });

  test("rejects a bundle whose version code isn't the release's", async () => {
    const play = fakePlay();
    await expect(run(play.client, { version: "1.0.94" })).rejects.toThrow(
      "version code 1000093, not 1000094"
    );
    expect(play.state.deleted).toEqual(["edit-1"]);
  });

  test("the proof reads both tracks back", async () => {
    const play = fakePlay();
    await run(play.client);
    const proof = await readProof({
      client: play.client,
      version: "1.0.93",
      releaseNotes: "Notes",
      now: () => new Date("2026-11-06T00:00:00Z"),
    });
    expect(proof).toEqual({
      version: "1.0.93",
      versionCode: 1_000_093,
      tracks: {
        internal: { status: "completed", versionCodes: ["1000093"] },
        production: { status: "completed", versionCodes: ["1000093"] },
      },
      releaseNotes: "Notes",
      checkedAt: "2026-11-06T00:00:00.000Z",
    });
  });
});

describe("Play sign-in", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const serviceAccount = {
    client_email: "teak-play-publisher@example.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    token_uri: "https://oauth2.googleapis.com/token",
  };

  test("signs an RS256 assertion for the androidpublisher scope", () => {
    const [header, claims, signature] = signedAssertion(
      serviceAccount,
      1000
    ).split(".");
    expect(
      crypto.verify(
        "RSA-SHA256",
        Buffer.from(`${header}.${claims}`),
        publicKey,
        Buffer.from(signature, "base64url")
      )
    ).toBe(true);
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toEqual({
      iss: serviceAccount.client_email,
      scope: "https://www.googleapis.com/auth/androidpublisher",
      aud: "https://oauth2.googleapis.com/token",
      iat: 1000,
      exp: 4600,
    });
  });

  test("refuses a key that points its token exchange elsewhere", () => {
    expect(() =>
      signedAssertion(
        { ...serviceAccount, token_uri: "https://example.com/token" },
        1
      )
    ).toThrow("token_uri");
  });

  test("reports Google's sign-in error", async () => {
    const fetch = async () =>
      new Response(
        JSON.stringify({
          error: "invalid_grant",
          error_description: "Invalid JWT",
        }),
        {
          status: 400,
        }
      );
    await expect(accessToken(serviceAccount, { fetch })).rejects.toThrow(
      "Invalid JWT"
    );
  });

  test("only sends the token to Google upload hosts", () => {
    expect(
      uploadSession("https://androidpublisher.googleapis.com/upload/x")
    ).not.toBeNull();
    expect(uploadSession("https://evil.example.com/upload")).toBeNull();
    expect(
      uploadSession("https://googleapis.com.evil.example/upload")
    ).toBeNull();
    expect(
      uploadSession("http://androidpublisher.googleapis.com/upload")
    ).toBeNull();
    expect(uploadSession(null)).toBeNull();
  });
});
