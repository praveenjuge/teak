import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  convexDeploymentSelectors,
  parseConvexCliResponse,
  runConvexFunction,
} from "./convex-cli-response";

const execute = promisify(execFile);

// Exercise captured stdout from real child processes, including the CLI's
// empty successful null response. No injected Convex transport bypasses parsing.
async function cliStdout(output: string) {
  const { stdout } = await execute(process.execPath, [
    "-e",
    "process.stdout.write(process.argv[1])",
    output,
  ]);
  return parseConvexCliResponse(stdout);
}

test.each(["", "\n", " \n\t", "null\n"])(
  "parses successful CLI null output %j",
  async (output) => {
    expect(await cliStdout(output)).toBeNull();
  }
);
test("preserves structured non-null CLI results", async () => {
  expect(
    await cliStdout('{"holder":"approved-holder","generation":7}\n')
  ).toEqual({ holder: "approved-holder", generation: 7 });
});
test.each([
  "not-json",
  '{"holder":"private-credential"',
  "null\nunexpected-log",
])(
  "rejects malformed nonempty CLI output without leaking it %j",
  async (output) => {
    await expect(cliStdout(output)).rejects.toThrow(
      "Convex CLI returned invalid JSON"
    );
    try {
      await cliStdout(output);
    } catch (error) {
      expect(String(error)).not.toContain(output);
    }
  }
);
test("pinned Convex child targets only the named deployment", async () => {
  const names = [
    ...convexDeploymentSelectors,
    "WORKOS_API_KEY",
    "TEAK_UNRELATED",
  ];
  const saved = names.map((name) => [name, process.env[name]] as const);
  for (const selector of convexDeploymentSelectors) {
    process.env[selector] = `ambient-${selector}`;
  }
  process.env.WORKOS_API_KEY = "operator-key";
  process.env.TEAK_UNRELATED = "kept";
  const seen: { args: string[]; cwd: string; env: NodeJS.ProcessEnv }[] = [];
  try {
    const result = await runConvexFunction(
      "exact-target",
      "module:query",
      { cursor: null },
      1024,
      (_file, args, options) => {
        seen.push({ args, cwd: options.cwd, env: options.env });
        return Promise.resolve({ stdout: '{"ok":true}\n' });
      }
    );
    expect(result).toEqual({ ok: true });
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
  expect(seen[0].args).toEqual([
    "--no-env-file",
    "x",
    "convex",
    "run",
    "--deployment-name",
    "exact-target",
    "module:query",
    '{"cursor":null}',
  ]);
  expect(seen[0].cwd.endsWith("packages/convex")).toBe(true);
  for (const selector of convexDeploymentSelectors) {
    expect(seen[0].env[selector]).toBe("");
  }
  expect("WORKOS_API_KEY" in seen[0].env).toBe(false);
  expect(seen[0].env.TEAK_UNRELATED).toBe("kept");
});
test("nonzero CLI exit never reaches the null parser", async () => {
  await expect(
    execute(process.execPath, ["-e", "process.exit(1)"])
  ).rejects.toThrow();
});
