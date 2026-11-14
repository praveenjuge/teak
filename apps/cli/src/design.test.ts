import { describe, expect, test } from "bun:test";
import { bulkItemProblem } from "@teak/convex/shared/bulkItems";
import { type Command, InvalidArgumentError } from "commander";
import { TeakApiError } from "teak-sdk";
import {
  CliError,
  ConfirmationRequiredError,
  describeError,
  ERROR_REASONS,
  formatErrorText,
  InterruptedError,
} from "./errors";
import { formatCardLine, formatCardTable } from "./format";
import {
  commandPath,
  completionScript,
  completions,
  EXAMPLES,
  findCommand,
} from "./help";
import { changesData, program, SHORTCUTS } from "./index";
import { collectPages } from "./library";
import { canPrompt, isAgent, isInteractive, type ModeInput } from "./mode";
import { parseDuration, parseTime } from "./options";
import { selectFields, unknownFields } from "./runtime";
import { terminalText } from "./terminal";
import { checkForUpdate, isNewer } from "./update";

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
      reason: "not_found",
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
    expect(formatErrorText(report).split("teak login")).toHaveLength(2);
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
      reason: "invalid_usage",
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
      (function* () {
        for (;;) {
          calls += 1;
          yield {
            items: [{ id: `c${calls}` }],
            pageInfo: { hasMore: true, nextCursor: `n${calls}` },
          } as never;
        }
      })(),
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
    ["removeTags", { cardId: "c1", tags: [] }, "Name at least one tag"],
    ["archive", { cardId: "" }, "Each bulk item must include a valid `cardId`"],
    ["delete", [], "Each bulk item must be an object"],
  ] as const)("%s %j", (operation, item, problem) => {
    expect(bulkItemProblem(operation, item)).toBe(problem);
  });
});

describe("terminal text", () => {
  test("keeps printable text, newlines and tabs, and drops control characters", () => {
    const esc = String.fromCharCode(27);
    expect(terminalText(`a${esc}]8;;https://x${esc}\\b\tc\r\nd\re`)).toBe(
      "a]8;;https://x\\b\tc\nd\ne"
    );
    expect(terminalText(`x${String.fromCharCode(0x9b)}31m`)).toBe("x31m");
    expect(terminalText("Café ☕ 日本")).toBe("Café ☕ 日本");
  });
});

describe("card table", () => {
  const row = (id: string, content: string, tags: string[] = []) => ({
    content,
    createdAt: Date.now() - 3 * 60 * 60 * 1000,
    id,
    tags,
    type: "text",
  });

  test("a person gets a header and aligned columns", () => {
    const lines = formatCardTable(
      [row("card_a", "short", ["design"]), row("card_long_id", "a longer one")],
      false
    ).split("\n");
    expect(lines[0]).toBe("ID            Type  Content       Tags     Age");
    expect(lines[1]).toBe("card_a        text  short         #design  3h");
    expect(lines[2]).toBe("card_long_id  text  a longer one           3h");
  });

  test("a file card shows its title or file name, not a blank cell", () => {
    const file = {
      content: "",
      createdAt: Date.now() - 3 * 60 * 60 * 1000,
      fileName: null,
      id: "card_img",
      metadataTitle: "Coral lily.webp",
      tags: [],
      type: "image",
    };
    const lines = formatCardTable([file], false).split("\n");
    expect(lines[1]).toBe("card_img  image  Coral lily.webp        3h");
    expect(formatCardTable([file], true)).toStartWith(
      "card_img\timage\tCoral lily.webp\t"
    );
    expect(
      formatCardLine({ ...file, fileName: "memo.m4a", metadataTitle: null })
    ).toContain("memo.m4a");
    expect(
      formatCardLine({ ...file, fileName: "memo.m4a", metadataTitle: "  " })
    ).toContain("memo.m4a");
    expect(formatCardLine({ ...file, content: "A caption" }, true)).toContain(
      "\tA caption\t"
    );
  });

  test("a pipe gets tab-separated rows and no header", () => {
    const out = formatCardTable([row("card_a", "short")], true);
    expect(out.startsWith("card_a\ttext\tshort\t")).toBe(true);
  });
});

describe("update check", () => {
  const DAY = 24 * 60 * 60 * 1000;

  test("compares major, minor and patch as numbers", () => {
    expect(isNewer("1.0.10", "1.0.9")).toBe(true);
    expect(isNewer("1.0.9", "1.0.9")).toBe(false);
    expect(isNewer("1.0.8", "1.0.9")).toBe(false);
    expect(isNewer("2.0.0-beta.1", "1.9.9")).toBe(true);
  });

  test("asks at most once a day and says so at most once a day", async () => {
    let asked = 0;
    const fetchLatest = () => {
      asked += 1;
      return Promise.resolve("1.0.99");
    };
    const first = await checkForUpdate({
      current: "1.0.93",
      fetchLatest,
      now: 10 * DAY,
      state: {},
    });
    expect(first.notice).toBe(
      "teak-cli 1.0.99 is out (you have 1.0.93). Update with: npm install -g teak-cli@latest"
    );
    const later = await checkForUpdate({
      current: "1.0.93",
      fetchLatest,
      now: 10 * DAY + 1000,
      state: first.state,
    });
    expect(later.notice).toBeUndefined();
    expect(asked).toBe(1);
    const tomorrow = await checkForUpdate({
      current: "1.0.93",
      fetchLatest,
      now: 11 * DAY,
      state: later.state,
    });
    expect(tomorrow.notice).toBeDefined();
    expect(asked).toBe(2);
  });

  test("says nothing when up to date or offline, and doesn't retry offline each run", async () => {
    const upToDate = await checkForUpdate({
      current: "1.0.99",
      fetchLatest: () => Promise.resolve("1.0.99"),
      now: DAY,
      state: {},
    });
    expect(upToDate.notice).toBeUndefined();
    const offline = await checkForUpdate({
      current: "1.0.93",
      fetchLatest: () => Promise.reject(new Error("offline")),
      now: DAY,
      state: {},
    });
    expect(offline.notice).toBeUndefined();
    expect(offline.state.checkedAt).toBe(DAY);
  });
});

describe("error reasons", () => {
  test("each kind of failure has one stable reason", () => {
    const reason = (error: unknown) =>
      describeError(error, { apiUrl: "https://teakvault.com/api" }).reason;
    expect(reason(new TeakApiError("UNAUTHORIZED"))).toBe("login_required");
    expect(reason(new TeakApiError("CARD_LIMIT_REACHED"))).toBe(
      "limit_reached"
    );
    expect(reason(new TeakApiError("TIMEOUT"))).toBe("timed_out");
    expect(reason(new TeakApiError("NETWORK_ERROR"))).toBe("network");
    expect(reason(new ConfirmationRequiredError("add --yes"))).toBe(
      "confirmation_required"
    );
    expect(reason(new InterruptedError())).toBe("cancelled");
    expect(reason(new Error("boom"))).toBe("unknown");
    for (const error of [new InterruptedError(), new Error("x")]) {
      expect(ERROR_REASONS).toContain(reason(error));
    }
  });

  test("a stopped command says what is still true", () => {
    const report = describeError(
      new InterruptedError("The export keeps going on Teak."),
      { apiUrl: "https://teakvault.com/api" }
    );
    expect(report).toMatchObject({
      code: "CANCELLED",
      message: "Stopped.",
      next: "The export keeps going on Teak.",
      reason: "cancelled",
    });
  });
});

describe("reads and changes", () => {
  test("a command changes data when it calls more than reads", () => {
    expect(changesData("cards get")).toBe(false);
    expect(changesData("ls")).toBe(false);
    expect(changesData("rm")).toBe(true);
    expect(changesData("tags rename")).toBe(true);
    expect(changesData("completion")).toBe(false);
  });
});

describe("unknown fields", () => {
  test("names the fields no record has, and the fields there are", () => {
    expect(
      unknownFields({ items: [{ id: 1, url: 2 }, { id: 3 }] }, ["id", "uri"])
    ).toEqual({ known: ["id", "url"], unknown: ["uri"] });
    // An empty listing can't say which names are wrong.
    expect(unknownFields({ items: [] }, ["anything"]).unknown).toEqual([]);
  });
});
