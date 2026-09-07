import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openApiSpec } from "@teak/convex/publicApiOpenApi";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const generatedDir = join(root, ".generated");
const outPath = join(generatedDir, "openapi.json");

export const buildSpecJson = (spec: unknown): string =>
  `${JSON.stringify(spec, null, 2)}\n`;

export const writeIfChanged = (
  path: string,
  content: string
): "wrote" | "unchanged" => {
  mkdirSync(dirname(path), { recursive: true });
  const previous = existsSync(path) ? readFileSync(path, "utf-8") : null;
  if (previous === content) {
    return "unchanged";
  }
  writeFileSync(path, content);
  return "wrote";
};

const spec = {
  ...openApiSpec,
  servers: [
    { url: "https://teakvault.com/api" },
    { url: "https://api.teakvault.com" },
  ],
};

if (import.meta.main) {
  const result = writeIfChanged(outPath, buildSpecJson(spec));
  console.log(`${result === "wrote" ? "Wrote" : "Unchanged"} ${outPath}`);
}
