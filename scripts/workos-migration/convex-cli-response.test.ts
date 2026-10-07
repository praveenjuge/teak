import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseConvexCliResponse } from "./convex-cli-response";

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
test("nonzero CLI exit never reaches the null parser", async () => {
  await expect(
    execute(process.execPath, ["-e", "process.exit(1)"])
  ).rejects.toThrow();
});
