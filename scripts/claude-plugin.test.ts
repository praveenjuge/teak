import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TEAK_V1_TOOLS } from "@teak/convex/mcp/protocol";

const root = join(import.meta.dir, "..");
const plugin = join(root, "plugins/teak");
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));

const pluginTexts = () => {
  const files = [
    join(plugin, "skills/teak/SKILL.md"),
    join(plugin, "README.md"),
    ...readdirSync(join(plugin, "commands")).map((name) =>
      join(plugin, "commands", name)
    ),
  ];
  return files.map((file) => ({ file, text: readFileSync(file, "utf8") }));
};

describe("Claude plugin (plugins/teak)", () => {
  test("names only tools the MCP server has", () => {
    const tools = new Set(TEAK_V1_TOOLS.map((tool) => tool.name));
    for (const { file, text } of pluginTexts()) {
      for (const [name] of text.matchAll(/teak_v1_[a-z_]+/gu)) {
        expect({ file, name, known: tools.has(name) }).toEqual({
          file,
          name,
          known: true,
        });
      }
    }
  });

  test("connects to the same MCP server the registry and docs list", () => {
    const servers = readJson(join(plugin, ".mcp.json")).mcpServers;
    const registry = readJson(join(root, "server.json"));
    const wellKnown = readJson(
      join(root, "apps/docs/public/.well-known/mcp.json")
    );
    expect(servers).toEqual({
      teak: { type: "http", url: registry.remotes[0].url },
    });
    expect(wellKnown.endpoint).toBe(registry.remotes[0].url);
  });

  test("is listed by the repository's marketplace", () => {
    const marketplace = readJson(join(root, ".claude-plugin/marketplace.json"));
    const manifest = readJson(join(plugin, ".claude-plugin/plugin.json"));
    expect(marketplace.plugins).toEqual([
      expect.objectContaining({
        name: manifest.name,
        source: "./plugins/teak",
      }),
    ]);
  });
});
