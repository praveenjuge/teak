import { expect, test } from "bun:test";
import { join } from "node:path";

interface ProjectSpec {
  schemes: Record<string, { build?: { buildArchitectures?: string } }>;
}

// XcodeGen 2.47 changed the default from useTargetSettings to
// matchRunDestination. A scheme that leaves it out generates a different
// Teak.xcscheme on 2.46 and 2.47, and CI's "project matches project.yml"
// check then passes or fails by the XcodeGen version on the runner.
test("every scheme names its build architectures", async () => {
  const spec = Bun.YAML.parse(
    await Bun.file(join(import.meta.dir, "../project.yml")).text()
  ) as ProjectSpec;
  const schemes = Object.entries(spec.schemes);
  expect(schemes.length).toBeGreaterThan(0);
  for (const [name, scheme] of schemes) {
    expect([name, scheme.build?.buildArchitectures]).toEqual([
      name,
      "useTargetSettings",
    ]);
  }
});
