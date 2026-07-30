import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openApiSpec } from "@teak/convex/publicApiOpenApi";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(root, "openapi.json");

const spec = {
  ...openApiSpec,
  servers: [
    { url: "https://teakvault.com/api" },
    { url: "https://api.teakvault.com" },
  ],
};

writeFileSync(outPath, `${JSON.stringify(spec, null, 2)}\n`);
console.log(`Wrote ${outPath}`);
