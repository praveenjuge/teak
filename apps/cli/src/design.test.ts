import { describe, expect, test } from "bun:test";
import { type Command, InvalidArgumentError } from "commander";
import { TeakApiError } from "teak-sdk";
import { bulkItemProblem } from "./bulk";
import { CliError, describeError, formatErrorText } from "./errors";
import { formatCardLine } from "./format";
import {
  commandPath,
  completionScript,
  completions,
  EXAMPLES,
  findCommand,
} from "./help";
import { program, SHORTCUTS } from "./index";
import { collectPages } from "./library";
import { canPrompt, isAgent, isInteractive, type ModeInput } from "./mode";
import { parseDuration, parseTime } from "./options";
import { selectFields } from "./runtime";

const tty = (env: Record<string, string> = {}): ModeInput => ({
  env,
  stderrTTY: true,
  stdinTTY: true,
  stdoutTTY: true,
});

describe("modes", () => {
  test("a person at a terminal can be asked and shown tips", () => {
    expect(canPrompt(tty())).toBe(true);
    expect(isInteractive(tty())).toBe(true);
  });

  test.each(["CLAUDECODE", "AI_AGENT", "CURSOR_AGENT", "GEMINI_CLI", "CI"])(
    "%s never prompts, even in a terminal",
    (name) => {
      expect(canPrompt(tty({ [name]: "1" }))).toBe(false);
      expect(isInteractive(tty({ [name]: "1" }))).toBe(false);
    }
  );

  test("a variable set to 0 or false doesn't count", () => {
    expect(isAgent(tty({ CLAUDECODE: "0", AI_AGENT: "false" }))).toBe(false);
  });

  test("a pipe on stdin can't answer a prompt", () => {
    expect(canPrompt({ ...tty(), stdinTTY: false })).toBe(false);
  });
});

describe("times and durations", () => {
  const now = Date.UTC(2026, 10, 5, 12);

  test.each([
    ["2026-01-01", Date.UTC(2026, 0, 1)],
    ["2026-01-01T09:30:00Z", Date.UTC(2026, 0, 1, 9, 30)],
    ["1767225600000", 1_767_225_600_000],
    ["30m", now - 30 * 60_000],
    ["2h", now - 2 * 3_600_000],
    ["3d", now - 3 * 86_400_000],
    ["1w", now - 7 * 86_400_000],
  ])("%s is a time", (value, expected) => {
    expect(parseTime(value, now)).toBe(expected);
  });

  test.each(["soon", "", "-5", "2026-13-45", "3 days"])(
    "%p is not a time",
    (value) => {
      expect(() => parseTime(value, now)).toThrow(InvalidArgumentError);
    }
  );

  test.each([
    ["90s", 90_000],
    ["10m", 600_000],
    ["1h", 3_600_000],
    ["45", 45_000],
  ])("%s is a duration", (value, expected) => {
    expect(parseDuration(value)).toBe(expected);
  });

  test.each(["0", "-1m", "1d", "soon"])("%p is not a duration", (value) => {
    expect(() => parseDuration(value)).toThrow(InvalidArgumentError);
  });
});

describe("errors", () => {
  const context = { apiUrl: "https://teakvault.com/api" };

  test("a missing card names its id and says how to find one", () => {
    const report = describeError(
      new TeakApiError("NOT_FOUND", "Card not found", {
        requestId: "req_1",
        status: 404,
      }),
      { ...context, command: "cards get", ids: ["card_x"] }
    );
    expect(report).toEqual({
      code: "NOT_FOUND",
      message: "Card not found: card_x",
      next: 'Find a card\'s id with: teak search "<words>" (or teak trash for cards in Trash)',
      requestId: "req_1",
      status: 404,
    });
    expect(formatErrorText(report).split("\n")).toEqual([
      "Card not found: card_x",
      "Request ID: req_1",
      'Find a card\'s id with: teak search "<words>" (or teak trash for cards in Trash)',
    ]);
  });

  test("a rate limit says how long to wait", () => {
    const now = Date.UTC(2026, 0, 1);
    const report = describeError(
      new TeakApiError("RATE_LIMITED", undefined, { retryAt: now + 180_000 }),
      { ...context, now }
    );
    expect(report.next).toBe("Try again in 3 minutes.");
    expect(report.retryAt).toBe(now + 180_000);
  });

  test("a network failure names the API it tried", () => {
    expect(
      describeError(new TeakApiError("NETWORK_ERROR"), context).next
    ).toContain("https://teakvault.com/api");
  });

  test("the sign-in step isn't said twice", () => {
    const report = describeError(new TeakApiError("AUTH_REQUIRED"), context);
    expect(report.next).toContain("teak login");
    expect(formatErrorText(report)).toBe(report.message);
  });

  test("a usage error is USAGE and points at the command's help", () => {
    expect(
      describeError(new InvalidArgumentError("bad"), {
        ...context,
        command: "tags delete",
      })
    ).toEqual({
      code: "USAGE",
      message: "bad",
      next: "See the options with: teak tags delete --help",
    });
  });

  test("a CLI error carries its own next step", () => {
    const report = describeError(
      new CliError("TIMEOUT", "Stopped waiting after 10m.", {
        next: "Check on it with: teak export status",
      }),
      context
    );
    expect(report.next).toBe("Check on it with: teak export status");
  });
});

describe("output", () => {
  const card = {
    content: "A long\tnote\nwith lines",
    createdAt: Date.UTC(2026, 0, 2),
    id: "card_a",
    tags: ["a", "b", "c", "d", "e"],
    type: "text",
  };

  test("a piped card line is tab-separated, in full, in ISO time", () => {
    expect(formatCardLine(card, true)).toBe(
      "card_a\ttext\tA long note with lines\ta,b,c,d,e\t2026-01-02T00:00:00.000Z\t"
    );
    expect(formatCardLine({ ...card, isHidden: true }, true)).toEndWith(
      "\thidden"
    );
  });

  test("--fields keeps keys of each item, of each element, or of one result", () => {
    const page = {
      items: [{ id: "a", type: "text", url: null }],
      pageInfo: { nextCursor: null },
    };
    expect(selectFields(page, ["id", "url"])).toEqual({
      items: [{ id: "a", url: null }],
      pageInfo: { nextCursor: null },
    });
    expect(selectFields([{ id: "a", type: "x" }], ["id"])).toEqual([
      { id: "a" },
    ]);
    expect(selectFields({ id: "a", type: "x" }, ["type"])).toEqual({
      type: "x",
    });
    expect(selectFields({ id: "a" }, undefined)).toEqual({ id: "a" });
  });
});

describe("--all", () => {
  test("stops at the cap and keeps the cursor, so the listing isn't called complete", async () => {
    let calls = 0;
    const page = await collectPages(
      () => {
        calls += 1;
        return Promise.resolve({
          items: [{ id: `c${calls}` }],
          pageInfo: { hasMore: true, nextCursor: `n${calls}` },
        } as never);
      },
      true,
      3
    );
    expect(calls).toBe(3);
    expect(page.items).toHaveLength(3);
    expect(page.pageInfo).toEqual({ hasMore: true, nextCursor: "n3" });
  });
});

// Splits an example the way a shell would: spaces, and '…' or "…" quoting.
const words = (line: string) =>
  [...line.matchAll(/"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? ""
  );

const knownOptions = (command: Command) => {
  const known = new Set<string>(["--help", "-h"]);
  for (let scope: Command | null = command; scope; scope = scope.parent) {
    for (const option of scope.options) {
      if (option.long) {
        known.add(option.long);
      }
      if (option.short) {
        known.add(option.short);
      }
      if (option.negate && option.long) {
        known.add(option.long);
      }
    }
  }
  return known;
};

const takesValue = (command: Command, flag: string) => {
  for (let scope: Command | null = command; scope; scope = scope.parent) {
    const option = scope.options.find(
      (candidate) => candidate.long === flag || candidate.short === flag
    );
    if (option) {
      return option.required || option.optional;
    }
  }
  return false;
};

describe("help", () => {
  const examples = Object.entries(EXAMPLES).flatMap(([path, lines]) =>
    lines.map((line) => [path, line] as const)
  );

  test.each(examples)("%s: %s parses", (path, line) => {
    const tokens = words(line);
    expect(tokens[0]).toBe("teak");
    const rest = tokens.slice(1);
    const { command, consumed } = findCommand(program, rest);
    if (path !== "") {
      const depth = path.split(" ").length;
      expect(
        commandPath(findCommand(program, rest.slice(0, depth)).command)
      ).toBe(path);
    }
    const known = knownOptions(command);
    const positionals: string[] = [];
    const args = rest.slice(consumed);
    for (let index = 0; index < args.length; index += 1) {
      const token = args[index] ?? "";
      if (token === ">>" || token === ">") {
        break;
      }
      if (token.startsWith("-") && token !== "-") {
        expect(known).toContain(token);
        if (takesValue(command, token)) {
          index += 1;
        }
      } else {
        positionals.push(token);
      }
    }
    const declared = command.registeredArguments;
    const required = declared.filter((argument) => argument.required).length;
    expect(positionals.length).toBeGreaterThanOrEqual(required);
    if (!declared.at(-1)?.variadic) {
      expect(positionals.length).toBeLessThanOrEqual(declared.length);
    }
  });

  test("every visible command has examples", () => {
    const missing: string[] = [];
    const visit = (command: Command, prefix: string[]) => {
      for (const child of command.createHelp().visibleCommands(command)) {
        const path = [...prefix, child.name()];
        const key = path.join(" ");
        if (
          child.name() !== "help" &&
          !(key in SHORTCUTS) &&
          !EXAMPLES[key]?.length
        ) {
          missing.push(key);
        }
        visit(child, path);
      }
    };
    visit(program, []);
    expect(missing).toEqual([]);
  });

  test("each shortcut takes exactly the arguments and options of its cards command", () => {
    const shape = (command: Command) => ({
      arguments: command.registeredArguments.map((argument) => [
        argument.name(),
        argument.required,
        argument.variadic,
      ]),
      options: command.options.map((option) => option.flags).sort(),
    });
    for (const [shortcut, name] of Object.entries(SHORTCUTS)) {
      const top = findCommand(program, [shortcut]).command;
      const canonical = findCommand(program, ["cards", name]).command;
      expect({ shortcut, ...shape(top) }).toEqual({
        shortcut,
        ...shape(canonical),
      });
    }
  });

  test("rm means delete in every group", () => {
    expect(SHORTCUTS.rm).toBe("delete");
    for (const group of ["cards", "folders", "highlights"]) {
      expect(findCommand(program, [group, "rm"]).command.name()).toBe("delete");
    }
    // The old `tags rm` still works, unlisted: it says to use tags remove.
    const old = findCommand(program, ["tags", "rm"]).command;
    expect(
      old.createHelp().visibleCommands(old.parent as Command)
    ).not.toContain(old);
  });
});

describe("completion", () => {
  test("suggests subcommands, then options of the command so far", () => {
    expect(completions(program, ["ca"])).toEqual(["cards"]);
    expect(completions(program, ["cards", "un"])).toEqual([
      "unarchive",
      "unfavorite",
      "unpin",
    ]);
    expect(completions(program, ["tags", "delete", "--d"])).toEqual([
      "--dry-run",
    ]);
    expect(completions(program, ["ls", "--js"])).toEqual(["--json"]);
  });

  test("leaves out hidden names", () => {
    expect(completions(program, ["tags", "r"])).toEqual(["remove", "rename"]);
    expect(completions(program, ["fav", "x", "--re"])).toEqual([]);
  });

  test.each(["bash", "zsh", "fish"] as const)(
    "the %s script asks teak __complete",
    (shell) => {
      expect(completionScript(shell)).toContain("teak __complete");
    }
  );
});

describe("bulk dry run", () => {
  test.each([
    ["create", { content: "a note" }, null],
    ["create", { url: "https://example.com" }, null],
    ["create", { cardType: "text", content: "" }, null],
    [
      "create",
      { content: "  " },
      "Each create item must include `content` or `url`",
    ],
    [
      "create",
      { tags: ["x"] },
      "Each create item must include `content` or `url`",
    ],
    ["update", { cardId: "c1", notes: null }, null],
    [
      "update",
      { cardId: "c1" },
      "Each update item must include content, url, notes or tags",
    ],
    ["addTags", { cardId: "c1", tags: ["a"] }, null],
    [
      "removeTags",
      { cardId: "c1", tags: [] },
      "Each removeTags item must include `tags` as a list of names",
    ],
    ["archive", { cardId: "" }, "Each bulk item must include a valid `cardId`"],
    ["delete", [], "Each bulk item must be an object"],
  ] as const)("%s %j", (operation, item, problem) => {
    expect(bulkItemProblem(operation, item)).toBe(problem);
  });
});
