import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

/** Every workflow and composite action, relative to the repository root. */
const actionFiles = (): string[] => [
  ...readdirSync(join(ROOT, ".github/workflows"))
    .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
    .map((file) => `.github/workflows/${file}`),
  ...readdirSync(join(ROOT, ".github/actions")).map(
    (action) => `.github/actions/${action}/action.yml`
  ),
];
const USES_RE = /uses:\s*([^\s#]+)[^\S\n]*(?:#[^\S\n]*(\S+))?/g;
const PINNED_RE = /^[^@]+@[0-9a-f]{40}$/;
const EXACT_VERSION_RE = /^v\d+\.\d+\.\d+$/;

interface ActionUse {
  file: string;
  label?: string;
  ref: string;
}

export const listThirdPartyUses = (): ActionUse[] => {
  const uses: ActionUse[] = [];
  for (const file of actionFiles()) {
    const content = readFileSync(join(ROOT, file), "utf-8");
    for (const match of content.matchAll(USES_RE)) {
      const ref = match[1] ?? "";
      if (ref.startsWith("./") || ref.startsWith("docker://")) {
        continue;
      }
      uses.push({ file, ref, label: match[2] });
    }
  }
  return uses;
};

describe("workflows and actions", () => {
  test.each(actionFiles())("%s parses as YAML", (file) => {
    expect(() =>
      Bun.YAML.parse(readFileSync(join(ROOT, file), "utf-8"))
    ).not.toThrow();
  });

  test("every local action a workflow uses exists", () => {
    for (const file of actionFiles()) {
      const content = readFileSync(join(ROOT, file), "utf-8");
      for (const match of content.matchAll(/uses:\s*(\.\/\S+)/g)) {
        const action = match[1] ?? "";
        expect(
          existsSync(join(ROOT, action, "action.yml")),
          `${file}: ${action}`
        ).toBe(true);
      }
    }
  });
});

describe("actions pinned", () => {
  test("every third-party action pins a full commit SHA", () => {
    const uses = listThirdPartyUses();
    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) {
      expect(use.ref, `${use.file}: ${use.ref}`).toMatch(PINNED_RE);
    }
  });

  test("every pin names its exact release, the same one wherever it appears", () => {
    const labels = new Map<string, string>();
    for (const use of listThirdPartyUses()) {
      expect(use.label ?? "", `${use.file}: ${use.ref}`).toMatch(
        EXACT_VERSION_RE
      );
      const seen = labels.get(use.ref);
      expect(seen ?? use.label, `${use.file}: ${use.ref}`).toBe(use.label);
      labels.set(use.ref, use.label ?? "");
    }
  });

  test("every action runs one release across all workflows", () => {
    const pins = new Map<string, string>();
    for (const use of listThirdPartyUses()) {
      const action = use.ref.slice(0, use.ref.lastIndexOf("@"));
      const seen = pins.get(action);
      expect(seen ?? use.ref, `${use.file}: ${action}`).toBe(use.ref);
      pins.set(action, use.ref);
    }
  });
});
