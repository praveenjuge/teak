import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const USES_RE = /uses:\s*([^\s#]+)[^\S\n]*(?:#[^\S\n]*(\S+))?/g;
const PINNED_RE = /^[^@]+@[0-9a-f]{40}$/;
const EXACT_VERSION_RE = /^v\d+\.\d+\.\d+$/;

interface ActionUse {
  file: string;
  label?: string;
  ref: string;
}

export const listThirdPartyUses = (
  workflowsDir: string = join(ROOT, ".github/workflows")
): ActionUse[] => {
  const uses: ActionUse[] = [];
  for (const file of readdirSync(workflowsDir)) {
    if (!(file.endsWith(".yml") || file.endsWith(".yaml"))) {
      continue;
    }
    const content = readFileSync(join(workflowsDir, file), "utf-8");
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
