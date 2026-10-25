import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TESTS = join(import.meta.dir, "../Packages/TeakKit/Tests/TeakCoreTests");
const TRAIT = /\.(english|switchesLanguage)\b/;
const TYPE =
  /^(\s*)(?:@Suite\b(.*?)\s+)?(?:(?:private|fileprivate|final|public|internal)\s+)*(struct|class|enum|actor|extension)\s+(\w+)/;

// AppLanguage is shared by every suite, and Swift Testing runs suites in
// parallel: each suite says whether it reads English or switches the language
// (Tests/TeakCoreTests/Language.swift). Swift Testing treats any type with a
// @Test as a suite, so every @Test needs a type around it that takes a trait.
const unmarkedTests = (files: Record<string, string>) => {
  const missing: string[] = [];
  const marked = new Set<string>();
  for (const [file, source] of Object.entries(files)) {
    const open: { indent: number; name: string; trait: boolean }[] = [];
    let attribute = "";
    for (const line of source.split("\n")) {
      if (/^\s*@Suite\b/.test(line) && !TYPE.test(line)) {
        attribute = line;
        continue;
      }
      const type = line.match(TYPE);
      if (type) {
        const indent = type[1]?.length ?? 0;
        while (open.length && (open.at(-1)?.indent ?? 0) >= indent) {
          open.pop();
        }
        const suite = type[2] ?? attribute;
        const name = type[4] ?? "";
        const trait =
          TRAIT.test(suite) || (type[3] === "extension" && marked.has(name));
        if (/@Suite\b/.test(line) || attribute) {
          if (trait) {
            marked.add(name);
          } else {
            missing.push(`${file}: suite ${name} takes no language trait`);
          }
        }
        open.push({ indent, name, trait });
        attribute = "";
        continue;
      }
      const at = line.match(/^(\s*)@Test\b/);
      if (!at) {
        continue;
      }
      const indent = at[1]?.length ?? 0;
      const around = open.filter((type) => type.indent < indent);
      if (around.length === 0) {
        missing.push(`${file}: a @Test outside a suite`);
      } else if (!around.some((type) => type.trait || marked.has(type.name))) {
        missing.push(
          `${file}: ${around.at(-1)?.name} has a @Test but no trait`
        );
      }
    }
  }
  return [...new Set(missing)];
};

test("every TeakKit test suite declares how it uses the app's language", () => {
  const files = Object.fromEntries(
    readdirSync(TESTS)
      .filter((name) => name.endsWith(".swift"))
      .map((name) => [name, readFileSync(join(TESTS, name), "utf8")])
  );
  expect(unmarkedTests(files)).toEqual([]);
});

test("the check finds a type with tests but no trait", () => {
  expect(
    unmarkedTests({
      "A.swift": [
        "@Suite(.english) struct Marked {",
        "    @Test func a() {}",
        "}",
        "extension Marked {",
        "    @Test func b() {}",
        "}",
        "struct Plain {",
        "    @Test func c() {}",
        "}",
        "@Suite struct Bare {",
        "    @Test func d() {}",
        "}",
        "@Test func loose() {}",
      ].join("\n"),
    })
  ).toEqual([
    "A.swift: Plain has a @Test but no trait",
    "A.swift: suite Bare takes no language trait",
    "A.swift: Bare has a @Test but no trait",
    "A.swift: a @Test outside a suite",
  ]);
});
