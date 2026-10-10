import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CARD_TYPES,
  type CardSort,
  isCardType,
  parseTags,
  TeakApiError,
} from "@teak/convex/sdk";
import {
  COLOR_HUE_BUCKETS,
  VISUAL_STYLE_TAXONOMY,
} from "@teak/convex/shared/constants";
import { parseTimeSearchQuery } from "@teak/convex/shared/utils/timeSearch";
import { Command, CommanderError, InvalidArgumentError } from "commander";
import { addCard, readStdin } from "./files";
import { formatCardLine, formatDetail } from "./format";
import {
  authStatus,
  collectPages,
  deleteCards,
  downloadCard,
  downloadExport,
  editTags,
  exportStatus,
  openCard,
  restoreCards,
  startExport,
  whoami,
} from "./library";
import {
  type ClientOptions,
  client,
  EXIT,
  exitCodeFor,
  type GlobalOptions,
  login,
  logout,
  readCredentials,
  readJson,
  VERSION,
  write,
  writeError,
} from "./runtime";

export { getUploadFileInfo, mimeFor } from "./files";
export { formatCardLine } from "./format";

const parseLimit = (value: string) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new InvalidArgumentError("limit must be a positive number");
  }
  return parsed;
};

const parseSince = (value: string) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new InvalidArgumentError("since must be a millisecond timestamp");
  }
  return parsed;
};

const parseType = (value: string) => {
  if (!isCardType(value)) {
    throw new InvalidArgumentError(
      `type must be one of: ${CARD_TYPES.join(", ")}`
    );
  }
  return value;
};

const oneOf =
  (name: string, values: readonly string[]) =>
  (value: string): string => {
    const normalized = value.trim().toLowerCase();
    if (!values.includes(normalized)) {
      throw new InvalidArgumentError(
        `${name} must be one of: ${values.join(", ")}`
      );
    }
    return normalized;
  };

// Repeatable flags: `--type image --type link` matches either.
const repeatable =
  <T>(parse: (value: string) => T) =>
  (value: string, previous: T[] = []) => [...previous, parse(value)];

const parseHex = (value: string) => {
  if (!/^#?(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value.trim())) {
    throw new InvalidArgumentError("hex must be a color such as #112233");
  }
  return value.trim();
};

export const parseDateRange = (value: string, now?: Date) => {
  const parsed = parseTimeSearchQuery(value, { now });
  if (!parsed) {
    throw new InvalidArgumentError(
      'date must be a phrase such as "today", "last week", "march 2026", or "2026-01-01 to 2026-02-01"'
    );
  }
  return parsed.range;
};

export const parseSort = (value: string): CardSort => {
  if (!(value === "newest" || value === "oldest")) {
    throw new InvalidArgumentError("sort must be newest or oldest");
  }
  return value;
};

const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.length > 0 ? value : undefined;

export const queryOptions = (options: Record<string, unknown>) => {
  const sort: CardSort | undefined =
    options.sort === "newest" || options.sort === "oldest"
      ? options.sort
      : undefined;
  const range = options.date as { end: number; start: number } | undefined;
  return {
    createdAfter:
      typeof options.createdAfter === "string"
        ? Number(options.createdAfter)
        : range?.start,
    createdBefore:
      typeof options.createdBefore === "string"
        ? Number(options.createdBefore)
        : range?.end,
    cursor: typeof options.cursor === "string" ? options.cursor : undefined,
    favorited: options.favorited === true,
    hex: strings(options.hex),
    hue: strings(options.hue),
    // List lines show a content snippet, so fetch content unless told otherwise.
    include: typeof options.include === "string" ? options.include : "content",
    limit: typeof options.limit === "number" ? options.limit : undefined,
    query: typeof options.query === "string" ? options.query : undefined,
    sort,
    style: strings(options.style),
    tag: typeof options.tag === "string" ? options.tag : undefined,
    trashed: options.trashed === true,
    type: strings(options.type),
  };
};

const withListOptions = (command: Command) =>
  command
    .option("-q, --query <text>")
    .option(
      "--type <type>",
      "card type; repeat to match any of several",
      repeatable(parseType)
    )
    .option("--tag <tag>", "exact tag")
    .option("--favorited", "favorites only")
    .option("--trashed", "cards in Trash only")
    .option(
      "--style <style>",
      `visual style, repeatable: ${VISUAL_STYLE_TAXONOMY.join(", ")}`,
      repeatable(oneOf("style", VISUAL_STYLE_TAXONOMY))
    )
    .option(
      "--hue <hue>",
      `color family, repeatable: ${COLOR_HUE_BUCKETS.join(", ")}`,
      repeatable(oneOf("hue", COLOR_HUE_BUCKETS))
    )
    .option("--hex <color>", "exact color, repeatable", repeatable(parseHex))
    .option(
      "--date <phrase>",
      'created in a range, such as "last week" or "march 2026"',
      (value) => parseDateRange(value)
    )
    .option("--limit <n>", "result limit", parseLimit)
    .option("--cursor <cursor>")
    .option("--sort <sort>", "newest or oldest", parseSort)
    .option("--created-after <ms>")
    .option("--created-before <ms>")
    .option("--include <groups>", "content, metadata, processing")
    .option("--all", "follow every page");

type ListMode = "list" | "search" | "favorites";

const writeCards = async (
  options: ClientOptions & Record<string, unknown>,
  mode: ListMode = "list"
) => {
  const api = client(options);
  const query = queryOptions(options);
  const fetchPage = (cursor?: string) => {
    const input = cursor ? { ...query, cursor } : query;
    if (mode === "favorites") {
      return api.cards.favorites(input);
    }
    return mode === "search" ? api.cards.search(input) : api.cards.list(input);
  };
  const page = await collectPages(fetchPage, options.all === true);
  write(
    options.json ? page : page.items.map(formatCardLine).join("\n"),
    options
  );
  if (!(options.json || page.pageInfo.nextCursor === null)) {
    process.stderr.write(`nextCursor: ${page.pageInfo.nextCursor}\n`);
  }
};

const withDeleteOptions = (command: Command) =>
  command
    .option("--permanent", "delete forever instead of moving to Trash")
    .option("-y, --yes", "skip the confirmation for --permanent");

const favoriteCard = async (
  id: string,
  remove: boolean,
  options: GlobalOptions
) => {
  const card = await client(options).cards.setFavorite(id, !remove);
  write(options.json ? card : formatCardLine(card), options);
};

const createCard = async (
  content: string | undefined,
  options: ClientOptions & {
    file?: string;
    notes?: string;
    tags?: string;
    type?: string;
    url?: string;
  }
) => {
  const result = await addCard(content, options);
  write(options.json ? result : `${result.cardId}  ${result.appUrl}`, options);
};

const listTags = async (options: GlobalOptions) => {
  const result = await client(options).tags.list();
  write(
    options.json
      ? result
      : result.items.map((tag) => `${tag.name}  ${tag.count}`).join("\n"),
    options
  );
};

// Set before adding subcommands: they copy this setting when created, so
// flag errors reach run() and exit with the usage code.
const program = new Command()
  .name("teak")
  .description("Command line client for Teak")
  .exitOverride()
  .version(VERSION)
  .option("--api-key <key>", "Teak API key")
  .option("--api-url <url>", "Teak API base URL", process.env.TEAK_API_URL)
  .option("--json", "emit JSON");

program
  .command("login")
  .option("--no-browser")
  .action(async (options) =>
    write(await login({ ...program.opts(), ...options }), program.opts())
  );

program.command("logout").action(async () => {
  const notice = await logout(program.opts());
  write(notice ?? "Logged out of Teak.", program.opts());
});

program
  .command("auth")
  .command("status")
  .action(async () => {
    const options = program.opts();
    let source = "none";
    if (options.apiKey || process.env.TEAK_API_KEY) {
      source = "api-key";
    } else if (readCredentials(options)) {
      source = process.platform === "darwin" ? "keychain" : "file";
    }
    if (source === "none") {
      throw new TeakApiError("AUTH_REQUIRED");
    }
    await authStatus(options, source);
  });

program
  .command("whoami")
  .description("Show your account, plan, and card usage")
  .action(async () => whoami(program.opts()));

const withAddOptions = (command: Command) =>
  command
    .argument("[content]")
    .option("--url <url>")
    .option("--file <path>")
    .option("--tags <tags>")
    .option("--notes <notes>")
    .option(
      "--type <type>",
      "card type; omit to let Teak detect links, quotes, and palettes",
      parseType
    )
    .action(async (content, options) =>
      createCard(content, { ...program.opts(), ...options })
    );

const readContentOption = async (value: string | undefined) =>
  value === "-" ? await readStdin() : value;

const cards = program.command("cards");
withListOptions(cards.command("list").alias("ls")).action(async (options) =>
  writeCards({ ...program.opts(), ...options })
);
withListOptions(cards.command("search").argument("[query]")).action(
  async (query, options) =>
    writeCards(
      { ...program.opts(), ...options, query: query || options.query },
      "search"
    )
);
withListOptions(cards.command("favorites")).action(async (options) =>
  writeCards({ ...program.opts(), ...options }, "favorites")
);
withListOptions(cards.command("trash")).action(async (options) =>
  writeCards({ ...program.opts(), ...options, trashed: true })
);
cards
  .command("get")
  .argument("<id>")
  .action(async (id) => {
    const options = program.opts();
    const card = await client(options).cards.get(id);
    write(options.json ? card : formatDetail(card), options);
  });
withAddOptions(cards.command("create").alias("add"));
cards
  .command("update")
  .argument("<id>")
  .option("--content <text>", "new content, or - to read stdin")
  .option("--title <title>", 'card title; "" clears it')
  .option("--notes <notes>")
  .option("--url <url>")
  .option("--tags <tags>", "replaces the card's own tags")
  .action(async (id, options) => {
    const opts = { ...program.opts(), ...options };
    const card = await client(opts).cards.update(id, {
      content: await readContentOption(options.content),
      metadataTitle: options.title,
      notes: options.notes,
      tags: parseTags(options.tags),
      url: options.url,
    });
    write(opts.json ? card : formatCardLine(card), opts);
  });
withDeleteOptions(
  cards.command("delete").alias("rm").argument("<ids...>")
).action(async (ids, options) =>
  deleteCards(ids, { ...program.opts(), ...options })
);
cards
  .command("restore")
  .argument("<ids...>")
  .description("Restore cards from Trash")
  .action(async (ids) => restoreCards(ids, program.opts()));
cards
  .command("open")
  .argument("<id>")
  .description("Open a card in Teak on the web")
  .action(async (id) => openCard(id, program.opts()));
cards
  .command("download")
  .argument("<id>")
  .description("Save a card's original file")
  .option("-o, --output <path>", "where to save it; defaults to its file name")
  .option("--force", "replace an existing file")
  .action(async (id, options) =>
    downloadCard(id, { ...program.opts(), ...options })
  );
cards
  .command("favorite")
  .alias("fav")
  .argument("<id>")
  .option("--remove")
  .action(async (id, options) => {
    await favoriteCard(id, options.remove, { ...program.opts(), ...options });
  });
cards
  .command("bulk")
  .argument("<operation>")
  .option("--input <file>")
  .action(async (operation, options) => {
    if (!["create", "update", "favorite", "delete"].includes(operation)) {
      throw new InvalidArgumentError(
        "operation must be create, update, favorite, or delete"
      );
    }
    const opts = { ...program.opts(), ...options };
    const raw = options.input
      ? readFileSync(options.input, "utf8")
      : await readStdin();
    const items = readJson<unknown[]>(raw);
    if (!Array.isArray(items)) {
      throw new InvalidArgumentError("bulk input must be a JSON array");
    }
    const result = await client(opts).cards.bulk(operation, items);
    write(
      opts.json
        ? result
        : `${result.summary.succeeded}/${result.summary.total} succeeded`,
      opts
    );
    if (result.summary.failed > 0) {
      process.exitCode = EXIT.api;
    }
  });
cards
  .command("changes")
  .requiredOption("--since <ms>", "millisecond timestamp", parseSince)
  .option("--cursor <cursor>")
  .option("--limit <n>", "result limit", parseLimit)
  .action(async (options) => {
    const opts = { ...program.opts(), ...options };
    const result = await client(opts).cards.changes(options);
    write(
      opts.json ? result : result.items.map(formatCardLine).join("\n"),
      opts
    );
  });

const tags = program
  .command("tags")
  .description("List tags")
  .action(async () => {
    await listTags(program.opts());
  });
tags.command("list").action(async () => listTags(program.opts()));
tags
  .command("add")
  .description("Add tags to a card")
  .argument("<id>")
  .argument("<tags...>")
  .action(async (id, names) => editTags(id, names, "add", program.opts()));
tags
  .command("rm")
  .alias("remove")
  .description("Remove tags from a card, including tags Teak added")
  .argument("<id>")
  .argument("<tags...>")
  .action(async (id, names) => editTags(id, names, "remove", program.opts()));

const exportCommand = program
  .command("export")
  .description("Export every card and original file as a ZIP")
  .option("--wait", "wait until the export is ready")
  .option("-o, --output <path>", "wait, then save the ZIP here")
  .option("--force", "replace an existing file")
  .action(async (options) => startExport({ ...program.opts(), ...options }));
exportCommand
  .command("status")
  .description("Show the latest export")
  .action(async () => exportStatus(program.opts()));
exportCommand
  .command("download")
  .description("Save the latest ready export")
  .option("-o, --output <path>", "where to save the ZIP")
  .option("--force", "replace an existing file")
  .action(async (options) => downloadExport({ ...program.opts(), ...options }));

withListOptions(program.command("ls")).action(async (options) =>
  writeCards({ ...program.opts(), ...options })
);
withListOptions(program.command("search").argument("[query]")).action(
  async (query, options) =>
    writeCards(
      { ...program.opts(), ...options, query: query || options.query },
      "search"
    )
);
withListOptions(
  program.command("trash").description("List cards in Trash")
).action(async (options) =>
  writeCards({ ...program.opts(), ...options, trashed: true })
);
withAddOptions(program.command("add"));
withDeleteOptions(program.command("rm").argument("<ids...>")).action(
  async (ids, options) => deleteCards(ids, { ...program.opts(), ...options })
);
program
  .command("restore")
  .argument("<ids...>")
  .description("Restore cards from Trash")
  .action(async (ids) => restoreCards(ids, program.opts()));
program
  .command("open")
  .argument("<id>")
  .description("Open a card in Teak on the web")
  .action(async (id) => openCard(id, program.opts()));
program
  .command("download")
  .argument("<id>")
  .description("Save a card's original file")
  .option("-o, --output <path>", "where to save it; defaults to its file name")
  .option("--force", "replace an existing file")
  .action(async (id, options) =>
    downloadCard(id, { ...program.opts(), ...options })
  );
program
  .command("fav")
  .argument("<id>")
  .option("--remove")
  .action(async (id, options) => {
    await favoriteCard(id, options.remove, { ...program.opts(), ...options });
  });

export const run = (argv = process.argv) => {
  return program.parseAsync(argv).catch((error) => {
    if (typeof error?.exitCode === "number" && error.exitCode === 0) {
      process.exit(0);
    }
    // Commander already printed what was wrong with the flags or arguments.
    if (
      error instanceof CommanderError &&
      !(error instanceof InvalidArgumentError)
    ) {
      process.exit(EXIT.usage);
    }
    const options = program.opts();
    writeError(error, options);
    process.exit(exitCodeFor(error));
  });
};

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  await run();
}
