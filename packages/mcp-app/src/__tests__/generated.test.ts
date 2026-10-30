import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { TEAK_APP_HTML } from "../../../convex/mcp/appHtml.generated";

const root = fileURLToPath(new URL("../..", import.meta.url));

test("Convex serves the view built from this source (run `bun run build` after a change)", () => {
  const outDir = mkdtempSync(join(tmpdir(), "teak-mcp-app-"));
  try {
    // The command `bun run build` runs, into a scratch folder.
    const built = Bun.spawnSync(
      [
        "bun",
        "--bun",
        "vite",
        "build",
        "--outDir",
        outDir,
        "--logLevel",
        "silent",
      ],
      { cwd: root, env: { ...process.env, NODE_ENV: "production" } }
    );
    expect(built.exitCode).toBe(0);
    expect(
      readFileSync(join(outDir, "index.html"), "utf8") === TEAK_APP_HTML
    ).toBe(true);
  } finally {
    rmSync(outDir, { force: true, recursive: true });
  }
}, 60_000);
