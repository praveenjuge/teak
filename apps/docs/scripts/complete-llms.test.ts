import { describe, expect, test } from "bun:test";
import { addAgentGuidance, extractAgentGuidance } from "./complete-llms";

describe("extractAgentGuidance", () => {
  test("reads the canonical section from the AI agent docs", () => {
    const source =
      "# Intro\n\n## When to use Teak\n\nCanonical guidance.\n\n## Next\n";
    expect(extractAgentGuidance(source)).toBe(
      "## When to use Teak\n\nCanonical guidance.\n"
    );
  });
});

describe("addAgentGuidance", () => {
  test("adds when-to-use guidance before the generated page index", () => {
    const result = addAgentGuidance(
      "# Teak\n\n> Summary\n\n## Docs\n\n- [Welcome](/docs)\n"
    );

    expect(result).toContain("## When to use Teak\n\nUse Teak when");
    expect(result.indexOf("## When to use Teak")).toBeLessThan(
      result.indexOf("## Docs")
    );
  });

  test("does not duplicate existing guidance", () => {
    const llms = "# Teak\n\n## When to use Teak\n\nExisting guidance.\n";
    expect(addAgentGuidance(llms)).toBe(llms);
  });
});
