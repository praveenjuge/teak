import { describe, expect, test } from "bun:test";
import {
  accessSync,
  constants,
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const SKILL = join(ROOT, ".agents/skills/verify-teak");
const FEATURES = join(SKILL, "features");

const FEATURE_SECTIONS = [
  /^Sub-features$/,
  /^How to get to it \(user POV\)$/,
  /^Driving it with .+$/,
  /^Gotchas$/,
];

const featureFiles = (): string[] =>
  readdirSync(FEATURES)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .sort();

const recipeFiles = (): string[] => [
  join(SKILL, "SKILL.md"),
  ...featureFiles().map((file) => join(FEATURES, file)),
];

// Ports are leased per checkout (scripts/dev/worktree-env.ts), so a recipe
// takes them from `bun run dev --status`. A port the recipe binds itself
// (`--port 8799`) is the exception.
const hardCodedPorts = (markdown: string): string[] => {
  const ownPorts = new Set(
    [...markdown.matchAll(/--port[ =](\d+)/g)].map((match) => match[1])
  );
  return [...markdown.matchAll(/(?:localhost|127\.0\.0\.1|\[::1\]):(\d+)/g)]
    .filter((match) => !ownPorts.has(match[1]))
    .map((match) => match[0]);
};

const seedPacks = (markdown: string): string[] => [
  ...new Set(
    [
      ...markdown.matchAll(/\b[Ss]eed(?:s|ed)? `([a-z0-9-]+)`/g),
      ...markdown.matchAll(/"scenario":\s*"([a-z0-9-]+)"/g),
    ].map((match) => match[1] ?? "")
  ),
];

// Repository paths in backticks. Ones with a placeholder (`<run-id>`) or a
// glob are patterns, and runtime files (.agents/.state, dotenv files,
// local.properties) exist only on a machine that ran the stack.
const repoPaths = (markdown: string): string[] =>
  [
    ...markdown.matchAll(
      /`((?:apps|packages|scripts|plugins|\.agents|\.github)\/[^`\s]+)`/g
    ),
  ]
    .map((match) => (match[1] ?? "").replace(/:\d+(?:-\d+)?$/, ""))
    .filter(
      (path) =>
        !(
          /[<>*…{]/.test(path) ||
          path.startsWith(".agents/.state/") ||
          /(?:^|\/)\.env|local\.properties$/.test(path)
        )
    );

// Every scenario pack devSeed:seedScenario knows, read from the message it
// throws for an unknown one (the pack table isn't exported).
const knownSeedPacks = async (): Promise<Set<string>> => {
  const previous = process.env.TEAK_DEV_DEPLOYMENT;
  process.env.TEAK_DEV_DEPLOYMENT = "true";
  try {
    const { seedScenario } = await import("../../packages/convex/devSeed.ts");
    const handler = (
      seedScenario as unknown as {
        _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
      }
    )._handler;
    const message = await handler(
      {},
      { workosUserId: "user_none", scenario: "__no_such_pack__" }
    ).then(
      () => "",
      (error: Error) => error.message
    );
    return new Set(
      [...message.matchAll(/^ {2}([a-z0-9-]+): /gm)].map(
        (match) => match[1] ?? ""
      )
    );
  } finally {
    if (previous === undefined) {
      delete process.env.TEAK_DEV_DEPLOYMENT;
    } else {
      process.env.TEAK_DEV_DEPLOYMENT = previous;
    }
  }
};

const relativeLinks = (markdown: string): string[] =>
  [...markdown.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)]
    .map((match) => match[1] ?? "")
    .filter((target) => !/^[a-z]+:/.test(target));

describe("verify-teak feature map", () => {
  test("the skill registers with a name and description", () => {
    const skill = readFileSync(join(SKILL, "SKILL.md"), "utf-8");
    expect(skill).toMatch(/^---\nname: verify-teak\ndescription: .+\n---\n/);
  });

  test("every feature file is listed in the index, and every index link resolves", () => {
    const index = readFileSync(join(FEATURES, "README.md"), "utf-8");
    const linked = relativeLinks(index).map((target) =>
      target.replace(/^\.\//, "")
    );
    expect(featureFiles().length).toBeGreaterThan(0);
    for (const file of featureFiles()) {
      expect(linked, `${file} is missing from features/README.md`).toContain(
        file
      );
    }
    for (const target of linked) {
      expect(
        existsSync(join(FEATURES, target)),
        `features/README.md links to missing ${target}`
      ).toBe(true);
    }
  });

  test.each(featureFiles())(
    "%s has a title, a summary and the four sections in order",
    (file) => {
      const text = readFileSync(join(FEATURES, file), "utf-8");
      expect(text, `${file} must start with an H1`).toMatch(/^# \S/);
      const intro = text.slice(text.indexOf("\n"), text.indexOf("\n## "));
      expect(
        intro.trim(),
        `${file} needs a summary paragraph before its first section`
      ).not.toBe("");
      const headings = [...text.matchAll(/^## (.+)$/gm)].map(
        (match) => match[1] ?? ""
      );
      expect(headings).toHaveLength(FEATURE_SECTIONS.length);
      headings.forEach((heading, i) => {
        expect(heading).toMatch(FEATURE_SECTIONS[i] as RegExp);
      });
    }
  );

  test("links from the skill and its features resolve", () => {
    const files = [
      join(SKILL, "SKILL.md"),
      ...featureFiles().map((f) => join(FEATURES, f)),
    ];
    for (const file of files) {
      for (const target of relativeLinks(readFileSync(file, "utf-8"))) {
        expect(
          existsSync(join(dirname(file), target)),
          `${file} links to missing ${target}`
        ).toBe(true);
      }
    }
  });

  test("recipes take ports from `bun run dev --status`", () => {
    for (const file of recipeFiles()) {
      expect(
        hardCodedPorts(readFileSync(file, "utf-8")),
        `${file} hard-codes a loopback port`
      ).toEqual([]);
    }
  });

  test("every seed pack a recipe names exists", async () => {
    const known = await knownSeedPacks();
    expect(known.size).toBeGreaterThan(10);
    for (const file of recipeFiles()) {
      for (const pack of seedPacks(readFileSync(file, "utf-8"))) {
        expect(known.has(pack), `${file} seeds unknown pack ${pack}`).toBe(
          true
        );
      }
    }
  });

  test("every repository path a recipe names exists", () => {
    for (const file of recipeFiles()) {
      for (const path of repoPaths(readFileSync(file, "utf-8"))) {
        expect(
          existsSync(join(ROOT, path)) || existsSync(join(SKILL, path)),
          `${file} names missing ${path}`
        ).toBe(true);
      }
    }
  });

  test("the recipe checks catch what they look for", () => {
    expect(hardCodedPorts("open `http://localhost:4100/x`")).toEqual([
      "localhost:4100",
    ]);
    expect(
      hardCodedPorts("`wrangler dev --port 8799`, then `localhost:8799`")
    ).toEqual([]);
    expect(seedPacks("Seed `resave`, then seed `folders-one`.")).toEqual([
      "resave",
      "folders-one",
    ]);
    expect(
      repoPaths(
        "`apps/web/src/x.ts:12`, `.agents/.state/stack.json`, `apps/<x>/y`"
      )
    ).toEqual(["apps/web/src/x.ts"]);
  });

  test.each(["doctor.ts", "api-key.ts"])("helper %s is executable", (name) => {
    expect(() =>
      accessSync(join(SKILL, "scripts", name), constants.X_OK)
    ).not.toThrow();
  });
});
