import { expect, test } from "bun:test";
import { join } from "node:path";

interface ProjectSpec {
  schemes: Record<string, { build?: { buildArchitectures?: string } }>;
}

const APPLE = join(import.meta.dir, "..");

// What XcodeGen writes on the scheme's BuildAction for each value.
const GENERATED: Record<string, string | null> = {
  matchRunDestination: "Automatic",
  useTargetSettings: null,
};

// XcodeGen 2.47 changed the default from useTargetSettings to
// matchRunDestination. A scheme that leaves it out generates a different
// .xcscheme on 2.46 and 2.47, and CI's "project matches project.yml" check
// then passes or fails by the XcodeGen version on the runner.
test("every scheme names its build architectures, and its generated scheme agrees", async () => {
  const spec = Bun.YAML.parse(
    await Bun.file(join(APPLE, "project.yml")).text()
  ) as ProjectSpec;
  const schemes = Object.entries(spec.schemes);
  expect(schemes.length).toBeGreaterThan(0);
  for (const [name, scheme] of schemes) {
    const named = scheme.build?.buildArchitectures ?? "(left to the default)";
    expect([name, named]).toEqual([
      name,
      expect.stringMatching(/^(matchRunDestination|useTargetSettings)$/),
    ]);
    const generated = await Bun.file(
      join(APPLE, `Teak.xcodeproj/xcshareddata/xcschemes/${name}.xcscheme`)
    ).text();
    const written =
      /buildArchitectures = "([^"]*)"/.exec(generated)?.[1] ?? null;
    expect([name, written]).toEqual([name, GENERATED[named] ?? null]);
  }
});
