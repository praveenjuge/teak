import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const USES_RE = /uses:\s*([^\s#]+)/g;
const PINNED_RE = /^[^@]+@[0-9a-f]{40}$/;

interface ActionUse {
  file: string;
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
      uses.push({ file, ref });
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
});
