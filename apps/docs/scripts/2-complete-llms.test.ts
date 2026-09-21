import { describe, expect, test } from "bun:test";
import { addAgentGuidance } from "./complete-llms";

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
