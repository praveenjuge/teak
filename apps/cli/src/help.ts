import { type Command, InvalidArgumentError } from "commander";
import { write } from "./runtime";

// One to three examples per command, keyed by its canonical path. Each one
// parses against the command tree (help.test.ts), so an example can't drift.
const ROOT_EXAMPLES = [
  'teak add "Design note from today\'s review" --tags design,research',
  'teak search "homepage inspiration"',
  'teak ls --type link --date "last week" --json --fields id,url',
];

export const EXAMPLES: Record<string, string[]> = {
  "": ROOT_EXAMPLES,
  login: ["teak login", "teak login --no-browser"],
  logout: ["teak logout"],
  auth: ["teak auth status"],
  cards: ["teak cards list", 'teak cards search "typography"'],
  highlights: ["teak highlights list <CARD_ID>"],
  "auth status": ["teak auth status", "teak auth status --json"],
  whoami: ["teak whoami"],
  "cards list": [
    "teak cards list --type link --hue blue",
    'teak cards list --tag design --date "last week"',
    "teak cards list --all --json --fields id,url",
  ],
  "cards search": [
    'teak cards search "site:github.com tag:design"',
    'teak cards search "design -tag:old" --mode keyword',
    "teak cards search typography -n 10",
  ],
  "cards similar": ["teak cards similar <CARD_ID>"],
  "cards favorites": ["teak cards favorites"],
  "cards pins": ["teak cards pins"],
  "cards pins order": ["teak cards pins order <CARD_ID> <CARD_ID>"],
  "cards trash": ["teak cards trash"],
  "cards get": ["teak cards get <CARD_ID>", "teak cards get <CARD_ID> --json"],
  "cards create": [
    'teak cards create "A note to keep" --tags ideas',
    "teak cards create --url https://example.com --tags reference",
    'teak cards create --file ./screenshot.png --notes "Homepage inspiration"',
  ],
  "cards update": [
    'teak cards update <CARD_ID> --title "New title"',
    "teak cards update <CARD_ID> --tags design,ux",
    'teak cards update <CARD_ID> --add-color "#2A9D8F"',
  ],
  "cards delete": [
    "teak cards delete <CARD_ID>",
    "teak cards delete <CARD_ID> --permanent --yes",
  ],
  "cards restore": ["teak cards restore <CARD_ID>"],
  "cards refresh": ["teak cards refresh <CARD_ID>"],
  "cards thumbnail": [
    "teak cards thumbnail <CARD_ID> ./cover.png",
    "teak cards thumbnail <CARD_ID> --reset",
  ],
  "cards archive": ["teak cards archive <CARD_ID> <CARD_ID>"],
  "cards unarchive": ["teak cards unarchive <CARD_ID>"],
  "cards duplicate": ["teak cards duplicate https://example.com/article"],
  "cards content": [
    "teak cards content <CARD_ID>",
    "teak cards content <CARD_ID> --kind article",
  ],
  "cards links": ["teak cards links <CARD_ID>"],
  "cards open": ["teak cards open <CARD_ID>"],
  "cards download": [
    "teak cards download <CARD_ID>",
    "teak cards download <CARD_ID> -o ./report.pdf",
  ],
  "cards favorite": ["teak cards favorite <CARD_ID>"],
  "cards unfavorite": ["teak cards unfavorite <CARD_ID>"],
  "cards pin": ["teak cards pin <CARD_ID>"],
  "cards unpin": ["teak cards unpin <CARD_ID>"],
  "cards done": ["teak cards done <CARD_ID>"],
  "cards todo": ["teak cards todo <CARD_ID>"],
  "cards save-pdf": ["teak cards save-pdf <CARD_ID>"],
  "cards bulk": [
    "teak cards bulk favorite --file ./items.json",
    "teak cards bulk addTags --file - --dry-run",
  ],
  "cards changes": [
    "teak cards changes --since 1d",
    "teak cards changes --since 2026-01-01 -n 100 --json",
  ],
  tags: ["teak tags"],
  "tags list": ["teak tags list"],
  "tags add": ["teak tags add <CARD_ID> design research"],
  "tags remove": ["teak tags remove <CARD_ID> draft"],
  "tags rename": [
    "teak tags rename ux design --dry-run",
    "teak tags rename ux design --wait",
  ],
  "tags merge": ["teak tags merge inspo inspiration --wait"],
  "tags delete": [
    "teak tags delete draft --dry-run",
    "teak tags delete draft --yes --wait",
  ],
  "tags status": ["teak tags status <OPERATION_ID> --wait --timeout 2m"],
  folders: ["teak folders"],
  "folders list": ["teak folders list"],
  "folders get": ["teak folders get Reading"],
  "folders create": [
    "teak folders create Reading --color blue",
    'teak folders create "Design links" --query "tag:design type:link"',
  ],
  "folders rules": [
    'teak folders rules Fonts --auto-file "tag:fonts" --wait',
    "teak folders rules Fonts --pause",
  ],
  "folders rule-run": ["teak folders rule-run Fonts --wait"],
  "folders undo-rule-run": ["teak folders undo-rule-run Fonts"],
  "folders rename": ["teak folders rename Reading Library --color green"],
  "folders delete": ["teak folders delete Reading"],
  "folders add": ["teak folders add Reading <CARD_ID> <CARD_ID>"],
  "folders remove": ["teak folders remove Reading <CARD_ID>"],
  "highlights list": ["teak highlights list <CARD_ID>"],
  "highlights add": [
    'teak highlights add <CARD_ID> "a passage from the article" --note "Why it matters"',
  ],
  "highlights note": [
    'teak highlights note <HIGHLIGHT_ID> "A new note"',
    "teak highlights note <HIGHLIGHT_ID> --clear",
  ],
  "highlights delete": ["teak highlights delete <HIGHLIGHT_ID>"],
  export: [
    "teak export --wait",
    "teak export -o ./teak-backup.zip --timeout 30m",
  ],
  "export status": ["teak export status"],
  "export download": ["teak export download -o ./teak-backup.zip"],
  completion: [
    "teak completion bash >> ~/.bashrc",
    "teak completion zsh > ~/.zfunc/_teak",
    "teak completion fish > ~/.config/fish/completions/teak.fish",
  ],
};

export const EXIT_CODES = [
  ["0", "success"],
  [
    "1",
    "the request failed, a wait timed out, or some items in a batch failed",
  ],
  ["2", "usage: an unknown command or option, a bad value, or a missing --yes"],
  ["3", "not signed in, or the API key was refused"],
  ["4", "not found"],
  ["5", "rate limited"],
  ["130", "stopped with Ctrl+C (143 when terminated, 129 on hangup)"],
] as const;

const ENVIRONMENT = [
  ["TEAK_API_KEY", "an API key; used instead of the saved sign-in"],
  ["TEAK_API_URL", "the API base URL (default https://teakvault.com/api)"],
  [
    "TEAK_API_REQUEST_TIMEOUT_MS",
    "how long one request may take (default 10000)",
  ],
  ["CI, CLAUDECODE, AI_AGENT…", "never prompt or open a browser"],
  [
    "TEAK_NO_UPDATE_CHECK",
    "don't ask npm once a day whether a newer teak-cli is out",
  ],
] as const;

const table = (rows: readonly (readonly [string, string])[]) => {
  const width = Math.max(...rows.map(([key]) => key.length));
  return rows.map(([key, text]) => `  ${key.padEnd(width)}  ${text}`);
};

export const rootHelpFooter = () =>
  [
    "",
    "Examples:",
    ...ROOT_EXAMPLES.map((line) => `  ${line}`),
    "",
    "Exit codes:",
    ...table(EXIT_CODES),
    "",
    "Environment:",
    ...table(ENVIRONMENT),
    "",
    "Add --json to any command for one JSON document on stdout, and --fields to keep only some keys.",
    'With --json, an error is one line on stderr: {"error":{"code","reason","message","next"}}.',
    'Find a command by what it does: teak help --search "<WORDS>". Help as JSON: teak help --json',
  ].join("\n");

export const commandPath = (command: Command) => {
  const names: string[] = [];
  let current: Command | null = command;
  while (current?.parent) {
    names.unshift(current.name());
    current = current.parent;
  }
  return names.join(" ");
};

/** Adds each command's examples below its help, walking the whole tree. */
export const addExamples = (
  root: Command,
  shortcuts: Record<string, string> = {}
) => {
  const visit = (command: Command) => {
    for (const child of command.commands) {
      const path = commandPath(child);
      const examples = EXAMPLES[shortcuts[path] ?? path];
      if (examples?.length) {
        child.addHelpText(
          "after",
          ["", "Examples:", ...examples.map((line) => `  ${line}`)].join("\n")
        );
      }
      visit(child);
    }
  };
  visit(root);
  root.addHelpText("after", rootHelpFooter());
};

/** Finds the command a list of words names, following aliases. */
export const findCommand = (root: Command, words: string[]) => {
  let command = root;
  let consumed = 0;
  for (const word of words) {
    const child = command.commands.find(
      (candidate) =>
        candidate.name() === word || candidate.aliases().includes(word)
    );
    if (!child) {
      break;
    }
    command = child;
    consumed += 1;
  }
  return { command, consumed };
};

/**
 * What can come next on a command line: subcommands, or with a leading dash
 * the options of the command so far and of the commands above it. `words`
 * ends with the word being completed, which may be empty.
 */
export const completions = (root: Command, words: string[]) => {
  const current = words.at(-1) ?? "";
  const before = words.slice(0, -1).filter((word) => !word.startsWith("-"));
  const { command } = findCommand(root, before);
  const help = command.createHelp();
  let candidates: string[];
  if (current.startsWith("-")) {
    candidates = [];
    for (let scope: Command | null = command; scope; scope = scope.parent) {
      for (const option of help.visibleOptions(scope)) {
        if (option.long) {
          candidates.push(option.long);
        }
      }
    }
  } else {
    candidates = help
      .visibleCommands(command)
      .map((child) => child.name())
      .filter((name) => name !== "help");
  }
  return [...new Set(candidates)]
    .filter((candidate) => candidate.startsWith(current))
    .sort();
};

export const SHELLS = ["bash", "zsh", "fish"] as const;

/** A script that asks `teak __complete` what comes next; it reads no files. */
export const completionScript = (shell: (typeof SHELLS)[number]) => {
  if (shell === "bash") {
    return [
      '# teak completion for bash. Add to ~/.bashrc: eval "$(teak completion bash)"',
      "_teak() {",
      "  local IFS=$'\\n'",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: bash syntax, not a template
      '  COMPREPLY=($(teak __complete "${COMP_WORDS[@]:1:COMP_CWORD}" 2>/dev/null))',
      "}",
      "complete -o default -F _teak teak",
    ].join("\n");
  }
  if (shell === "zsh") {
    return [
      "#compdef teak",
      "# teak completion for zsh. Save as _teak in a directory on $fpath.",
      "_teak() {",
      "  local -a candidates",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: zsh syntax, not a template
      '  candidates=("${(@f)$(teak __complete "${(@)words[2,CURRENT]}" 2>/dev/null)}")',
      "  compadd -a candidates",
      "}",
      'if [ "$funcstack[1]" = "_teak" ]; then _teak "$@"; else compdef _teak teak; fi',
    ].join("\n");
  }
  return [
    "# teak completion for fish. Save as ~/.config/fish/completions/teak.fish",
    "complete -c teak -f -a '(teak __complete (commandline -opc)[2..-1] (commandline -ct) 2>/dev/null)'",
  ].join("\n");
};

export interface CommandDescription {
  aliases: string[];
  arguments: {
    description: string;
    name: string;
    required: boolean;
    variadic: boolean;
  }[];
  command: string;
  commands: CommandDescription[];
  description: string;
  examples: string[];
  options: {
    description: string;
    flags: string;
    long: string | null;
    short: string | null;
    value: string | null;
  }[];
}

const visibleChildren = (command: Command) =>
  command
    .createHelp()
    .visibleCommands(command)
    .filter((child) => child.name() !== "help");

/**
 * A command and everything under it, from the same metadata `--help` prints:
 * what `teak help --json` and `teak <command> --help --json` show.
 */
export const describeCommand = (
  command: Command,
  shortcuts: Record<string, string> = {}
): CommandDescription => {
  const help = command.createHelp();
  const path = commandPath(command);
  return {
    command: `teak${path ? ` ${path}` : ""}`,
    description: command.description(),
    aliases: command.aliases(),
    arguments: command.registeredArguments.map((argument) => ({
      description: argument.description,
      name: argument.name(),
      required: argument.required,
      variadic: argument.variadic,
    })),
    options: help.visibleOptions(command).map((option) => ({
      description: option.description,
      flags: option.flags,
      long: option.long ?? null,
      short: option.short ?? null,
      value: /<[^>]+>|\[[^\]]+\]/.exec(option.flags)?.[0] ?? null,
    })),
    examples: EXAMPLES[shortcuts[path] ?? path] ?? [],
    commands: visibleChildren(command).map((child) =>
      describeCommand(child, shortcuts)
    ),
  };
};

/** The whole CLI as data: every command, the exit codes and the environment. */
export const describeCli = (
  root: Command,
  shortcuts: Record<string, string> = {}
) => ({
  ...describeCommand(root, shortcuts),
  environment: Object.fromEntries(ENVIRONMENT),
  exitCodes: Object.fromEntries(EXIT_CODES),
});

export interface CommandMatch {
  command: string;
  description: string;
  /** The top-level shortcut that runs the same command, such as `teak rm`. */
  shortcut?: string;
}

/**
 * The commands that do what some words describe, best match first: each word
 * is looked for at the start of a word in a command's name, aliases,
 * description, options and examples. Shortcuts show beside the command they
 * run, not as commands of their own.
 */
export const searchCommands = (
  root: Command,
  query: string,
  shortcuts: Record<string, string> = {}
): CommandMatch[] => {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const shortcutFor = Object.fromEntries(
    Object.entries(shortcuts).map(([shortcut, name]) => [
      `cards ${name}`,
      shortcut,
    ])
  );
  const matches: (CommandMatch & { depth: number; score: number })[] = [];
  const visit = (command: Command) => {
    for (const child of visibleChildren(command)) {
      const path = commandPath(child);
      if (shortcuts[path]) {
        continue;
      }
      const options = child.createHelp().visibleOptions(child);
      const text = [
        path,
        ...child.aliases(),
        child.description(),
        ...(EXAMPLES[path] ?? []),
        ...options.map((option) => `${option.flags} ${option.description}`),
      ]
        .join(" ")
        .toLowerCase()
        .split(/[^a-z0-9]+/);
      // A word in the command's own name counts double.
      const name = path.split(/[^a-z0-9]+/);
      const score = words.reduce(
        (total, word) =>
          total +
          (text.some((token) => token.startsWith(word)) ? 1 : 0) +
          (name.some((token) => token.startsWith(word)) ? 1 : 0),
        0
      );
      if (score > 0) {
        const shortcut = shortcutFor[path];
        matches.push({
          command: `teak ${path}`,
          depth: path.split(" ").length,
          description: child.description(),
          score,
          ...(shortcut ? { shortcut: `teak ${shortcut}` } : {}),
        });
      }
      visit(child);
    }
  };
  visit(root);
  return matches
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.depth - b.depth ||
        a.command.localeCompare(b.command)
    )
    .slice(0, 8)
    .map(({ depth: _depth, score: _score, ...match }) => match);
};

const beforeDoubleDash = (words: string[]) => {
  const end = words.indexOf("--");
  return end === -1 ? words : words.slice(0, end);
};

/**
 * `teak help --json`, `teak <command> --help --json` and `teak help --search
 * <words>`: help as data, and commands found by what they do. Like --help,
 * they read no credentials and make no request. Returns false for anything
 * else, which Commander handles.
 */
export const answerHelp = (
  root: Command,
  argv: string[],
  shortcuts: Record<string, string> = {}
) => {
  const words = beforeDoubleDash(argv.slice(2));
  const json = words.includes("--json");
  const asksHelp = words[0] === "help";
  const positional = (list: string[]) =>
    list.filter((word) => !word.startsWith("-"));
  const searchAt = words.indexOf("--search");
  if (asksHelp && searchAt !== -1) {
    const query = positional(words.slice(searchAt + 1)).join(" ");
    if (!query) {
      throw new InvalidArgumentError(
        'say what you want to do: teak help --search "move to trash"'
      );
    }
    const matches = searchCommands(root, query, shortcuts);
    if (json) {
      write({ query, results: matches }, { json: true });
    } else if (matches.length === 0) {
      process.stderr.write(
        "No commands match. See every command with: teak --help\n"
      );
    } else {
      const label = (match: (typeof matches)[number]) =>
        match.shortcut ? `${match.command} (${match.shortcut})` : match.command;
      const width = Math.max(...matches.map((match) => label(match).length));
      write(
        matches
          .map((match) => `${label(match).padEnd(width)}  ${match.description}`)
          .join("\n"),
        {}
      );
    }
    return true;
  }
  const asksFlag = words.includes("--help") || words.includes("-h");
  if (!(json && (asksHelp || asksFlag))) {
    return false;
  }
  const names = positional(asksHelp ? words.slice(1) : words);
  const { command } = findCommand(root, names);
  write(
    command === root
      ? describeCli(root, shortcuts)
      : describeCommand(command, shortcuts),
    { json: true }
  );
  return true;
};
