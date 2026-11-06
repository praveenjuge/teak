import { randomUUID } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FOLDER_COLORS } from "@teak/convex/shared/folders";
import { MAX_PINNED_CARDS } from "@teak/convex/shared/pins";
import {
  BULK_CARD_OPERATIONS,
  PUBLIC_API_MAX_BULK_ITEMS,
} from "@teak/convex/shared/publicApiContract";
import { randomShuffleSeed } from "@teak/convex/shared/search/shuffle";
import { THUMBNAIL_MAX_BYTES } from "@teak/convex/shared/thumbnails";
import { formatBytes } from "@teak/convex/shared/utils/formatBytes";
import {
  Command,
  CommanderError,
  InvalidArgumentError,
  Option,
} from "commander";
import {
  type BulkCardsOperation,
  type CardsPage,
  parseTags,
  TeakApiError,
} from "teak-sdk";
import { bulkItemProblem } from "./bulk";
import { addCard, readStdin } from "./files";
import { formatCardLines, formatCreated, formatDetail } from "./format";
import {
  addExamples,
  commandPath,
  completionScript,
  completions,
  SHELLS,
} from "./help";
import {
  addHighlight,
  authStatus,
  CONTENT_KINDS,
  changeFolderCards,
  collectPages,
  createFolder,
  deleteCards,
  deleteFolders,
  downloadCard,
  downloadExport,
  editTags,
  exportStatus,
  findDuplicateCard,
  folderRuleRunStatus,
  listFolders,
  listHighlights,
  noteHighlight,
  openCard,
  refreshCards,
  removeHighlights,
  resolveFolder,
  restoreCards,
  setCardsArchived,
  setCardThumbnail,
  setFolderRules,
  showCardContent,
  showCardLinks,
  showFolder,
  startExport,
  startTagOperation,
  tagOperationStatus,
  undoFolderRuleRun,
  updateFolder,
  whoami,
} from "./library";
import { plainOutput } from "./mode";
import {
  collectPaletteColor,
  cursorOption,
  DEFAULT_WAIT_TIMEOUT_MS,
  formatDuration,
  hiddenCursorOption,
  MAX_ALL_CARDS,
  oneOf,
  parseDuration,
  parseLimit,
  parseSince,
  parseType,
  queryOptions,
  withListOptions,
} from "./options";
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
  writeList,
  writeStatus,
  writeTip,
} from "./runtime";

export { getUploadFileInfo, mimeFor } from "./files";
export { formatCardLine } from "./format";
export { completions } from "./help";
export {
  parseDateRange,
  parseMode,
  parseSeed,
  parseSort,
  queryOptions,
} from "./options";

type ListMode = "list" | "search" | "favorites" | "pinned" | "similar";

export const listingJson = <T extends object>(
  page: T,
  seed: number | undefined
): T | (T & { seed: number }) =>
  seed === undefined ? page : { ...page, seed };

const meaningSearchSkipped = (
  page: CardsPage,
  options: Record<string, unknown>
) => page.searchMode === "keyword" && options.mode !== "keyword";

const relevanceUnscored = (page: CardsPage, options: Record<string, unknown>) =>
  options.sort === "relevance" && page.relevanceRanked === false;

const FILTER_OPTIONS = [
  "archived",
  "createdAfter",
  "createdBefore",
  "date",
  "folder",
  "hex",
  "hue",
  "query",
  "style",
  "tag",
  "type",
];

const hasFilters = (options: Record<string, unknown>) =>
  FILTER_OPTIONS.some((key) => {
    const value = options[key];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  });

const emptyListingMessage = (
  mode: ListMode,
  options: Record<string, unknown>
) => {
  // `list --favorited` and `list --similar-to` are the favorites and similar
  // listings by another name.
  let kind = mode;
  if (mode === "list" && options.similarTo) {
    kind = "similar";
  } else if (mode === "list" && options.favorited === true) {
    kind = "favorites";
  }
  // Say what the filters found, not that the whole collection is empty.
  if (kind === "search" || hasFilters(options)) {
    return kind === "search" && !hasFilters({ ...options, query: undefined })
      ? "No cards match that search."
      : "No cards match those filters.";
  }
  if (kind === "favorites") {
    return "No favorite cards yet.";
  }
  if (kind === "similar") {
    return "No similar cards yet.";
  }
  return options.trashed === true ? "Trash is empty." : "No cards.";
};

const writeCards = async (
  options: ClientOptions & Record<string, unknown>,
  mode: ListMode = "list"
) => {
  const api = client(options);
  const shuffleSeed =
    options.sort === "shuffle" && typeof options.seed !== "number"
      ? randomShuffleSeed()
      : undefined;
  if (shuffleSeed !== undefined && !options.json) {
    process.stderr.write(`seed: ${shuffleSeed}\n`);
  }
  const query = {
    ...queryOptions(
      shuffleSeed === undefined ? options : { ...options, seed: shuffleSeed }
    ),
    ...(typeof options.folder === "string"
      ? { folder: (await resolveFolder(api, options.folder)).id }
      : {}),
  };
  const fetchPage = (cursor?: string) => {
    const input = cursor ? { ...query, cursor } : query;
    if (mode === "favorites") {
      return api.cards.favorites(input);
    }
    if (mode === "pinned") {
      return api.cards.pinned(input);
    }
    if (mode === "similar" && input.similarTo) {
      const { similarTo, ...rest } = input;
      return api.cards.similar(similarTo, rest);
    }
    return mode === "search" ? api.cards.search(input) : api.cards.list(input);
  };
  const page = await collectPages(fetchPage, options.all === true);
  const stoppedEarly =
    options.all === true && page.pageInfo.nextCursor !== null;
  if (options.json) {
    write(
      listingJson(
        page,
        options.sort === "shuffle"
          ? (shuffleSeed ?? (options.seed as number | undefined))
          : undefined
      ),
      options
    );
  } else if (page.items.length > 0) {
    write(formatCardLines(page.items), options);
  } else if (!page.similarity || page.similarity === "ok") {
    // A similar-cards listing that isn't ready says why below instead.
    writeList([], emptyListingMessage(mode, options), options);
  }
  if (stoppedEarly && !options.json) {
    process.stderr.write(
      `Stopped at ${MAX_ALL_CARDS.toLocaleString("en-US")} cards; the listing goes on.\n`
    );
  }
  writeNextPage(page.pageInfo.nextCursor, options);
  if (!options.json && page.similarity && page.similarity !== "ok") {
    process.stderr.write(
      page.similarity === "pending"
        ? "Still learning about this card. Try again in a moment.\n"
        : "That card is in Trash or was not found.\n"
    );
  }
  if (!options.json && meaningSearchSkipped(page, options)) {
    process.stderr.write("mode: keyword\n");
  }
  if (!options.json && relevanceUnscored(page, options)) {
    process.stderr.write("relevance: unranked\n");
  }
};

/** While a listing goes on: the option that continues it, on stderr. */
const writeNextPage = (cursor: string | null, options: GlobalOptions) => {
  if (!options.json && cursor !== null) {
    process.stderr.write(`Next page: --next ${cursor}\n`);
  }
};

const withDeleteOptions = (command: Command) =>
  command
    .option("--permanent", "delete forever instead of moving to Trash")
    .option("-y, --yes", "skip the confirmation for --permanent");

const favoriteCard = async (
  id: string,
  favorite: boolean,
  options: GlobalOptions
) => {
  const card = await client(options).cards.setFavorite(id, favorite);
  write(options.json ? card : formatCardLines([card]), options);
};

const pinCard = async (id: string, pinned: boolean, options: GlobalOptions) => {
  const card = await client(options).cards.setPinned(id, pinned);
  write(options.json ? card : formatCardLines([card]), options);
};

const reorderPins = async (ids: string[], options: GlobalOptions) => {
  const cards = await client(options).cards.reorderPinned(ids);
  write(options.json ? cards : formatCardLines(cards), options);
};

const markCardDone = async (
  id: string,
  done: boolean,
  options: GlobalOptions
) => {
  const card = await client(options).cards.setDone(id, done);
  write(options.json ? card : formatCardLines([card]), options);
};

const savePdf = async (id: string, options: GlobalOptions) => {
  const saved = await client(options).cards.savePdf(id);
  const line = saved.created
    ? `Saved the PDF as ${saved.cardId}`
    : `Already saved as ${saved.cardId}`;
  write(options.json ? saved : line, options);
};

const createCard = async (
  content: string | undefined,
  options: ClientOptions & {
    file?: string;
    notes?: string;
    sourceTitle?: string;
    sourceUrl?: string;
    tags?: string;
    type?: string;
    url?: string;
  }
) => {
  const result = await addCard(content, options);
  write(options.json ? result : formatCreated(result), options);
  writeTip(`Open it with: teak open ${result.cardId}`, options);
};

const BULK_OPERATIONS: readonly string[] = BULK_CARD_OPERATIONS;

export const bulkItems = (input: unknown): unknown[] | null => {
  if (Array.isArray(input)) {
    return input;
  }
  const items = (input as { items?: unknown } | null)?.items;
  return input && typeof input === "object" && Array.isArray(items)
    ? items
    : null;
};

export const formatBulkResult = (value: unknown, position: number) => {
  const item = (value ?? {}) as {
    cardId?: unknown;
    code?: unknown;
    error?: unknown;
    index?: unknown;
    resaved?: unknown;
    status?: unknown;
  };
  const index = typeof item.index === "number" ? item.index : position;
  if (item.status === "success") {
    const resaved =
      item.resaved === true ? " (already in Teak, moved to the top)" : "";
    return `[${index}] ${String(item.cardId ?? "ok")}${resaved}`;
  }
  const message = typeof item.error === "string" ? item.error : "failed";
  return `[${index}] ${typeof item.code === "string" ? `${item.code}: ` : ""}${message}`;
};

const listTags = async (options: GlobalOptions) => {
  const result = await client(options).tags.list();
  if (options.json) {
    write(result, options);
    return;
  }
  const separator = plainOutput() ? "\t" : "  ";
  writeList(
    result.items.map((tag) => `${tag.name}${separator}${tag.count}`),
    "No tags yet.",
    options
  );
};

// A search that leaves something out (`teak search -tag:old`) reads as a flag
// to the shell and to Commander, so the search commands' error says how to
// pass it.
const searchQuotingHint = (message: string) =>
  /unknown option '-[^-'][^']+'/.test(message)
    ? `${message}To leave something out of a search, quote it: teak search "design -tag:old", or put -- before it: teak search -- -tag:old\n`
    : message;

// Before Commander runs any action it can't know --json was meant for a
// command it failed to parse, so this reads the arguments themselves.
const wantsJson = (argv = process.argv) => {
  const end = argv.indexOf("--");
  return (end === -1 ? argv : argv.slice(0, end)).includes("--json");
};

// Commander's own usage errors: with --json, one JSON line like every other
// error; otherwise its message, with a hint for some commands.
const usageOutput = (hint: (message: string) => string = (m) => m) => ({
  outputError: (message: string, writeErr: (text: string) => void) => {
    if (wantsJson()) {
      writeErr(
        `${JSON.stringify({
          error: {
            code: "USAGE",
            message: message.replace(/^error: /, "").trim(),
            next: "Add --help to the command to see its options.",
          },
        })}\n`
      );
      return;
    }
    writeErr(hint(message));
  },
});

const parseFields = (value: string) => {
  const fields = value
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
  if (fields.length === 0) {
    throw new InvalidArgumentError("fields must be names such as id,url");
  }
  return fields;
};

// Set before adding subcommands: they copy these settings when created, so
// flag errors reach run() and exit with the usage code.
export const program = new Command()
  .name("teak")
  .description("Command line client for Teak")
  .exitOverride()
  .configureOutput(usageOutput())
  .version(VERSION)
  .option(
    "--api-key <key>",
    "Teak API key (prefer TEAK_API_KEY: a flag is visible to other processes)"
  )
  // No default here: TEAK_API_URL is read where the URL is used, so
  // options.apiUrl is set only when someone passed --api-url.
  .option("--api-url <URL>", "Teak API base URL (same as TEAK_API_URL)")
  .option("--json", "print one JSON document on stdout")
  .option(
    "--fields <names>",
    "with --json, keep only these keys, e.g. id,url,tags",
    parseFields
  );

// The command that's running, for errors that name what it was given.
let activeCommand: Command | undefined;

program.hook("preAction", (_root, actionCommand) => {
  activeCommand = actionCommand;
  const options = program.opts();
  if (options.fields && !options.json) {
    throw new InvalidArgumentError("--fields works with --json");
  }
});

const globals = <T extends object>(options: T) => ({
  ...program.opts(),
  ...options,
});

/** A renamed command or flag: still works, says its new name to a person. */
const warnDeprecated = (message: string) => {
  if (!wantsJson()) {
    process.stderr.write(`Warning: ${message}\n`);
  }
};

const withWaitOptions = (command: Command, wait: string) =>
  command
    .option("--wait", wait)
    .option(
      "--timeout <DURATION>",
      `with --wait, stop waiting after this long (default ${formatDuration(DEFAULT_WAIT_TIMEOUT_MS)})`,
      parseDuration
    );

program
  .command("login")
  .description("Sign in to Teak in your browser")
  .option("--no-browser", "print the sign-in URL instead of opening it")
  .action(async (options) => {
    const opts = globals(options);
    const message = await login(opts);
    if (opts.json) {
      write(message, opts);
      return;
    }
    writeStatus(message, opts);
    writeTip('Save something with: teak add "<TEXT OR URL>"', opts);
  });

program
  .command("logout")
  .description("Sign out and disconnect the CLI")
  .action(async () => {
    const opts = program.opts();
    const message = await logout(opts);
    if (opts.json) {
      write(message, opts);
    } else {
      writeStatus(message, opts);
    }
  });

program
  .command("auth")
  .description("Check how the CLI signs in")
  .command("status")
  .description("Show which account and credential the CLI uses")
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

const readContentOption = async (value: string | undefined) =>
  value === "-" ? await readStdin() : value;

// Each card command is built by one function, so `teak cards <name>` and its
// top-level shortcut (`teak ls`, `teak rm`…) can't drift apart.
type Build = (parent: Command, name: string) => Command;

const listBuilder =
  (description: string, extra: Record<string, unknown> = {}): Build =>
  (parent, name) =>
    withListOptions(parent.command(name).description(description)).action(
      async (options) => writeCards(globals({ ...options, ...extra }))
    );

const searchBuilder: Build = (parent, name) =>
  withListOptions(
    parent
      .command(name)
      .argument("[query]")
      .description(
        "Search cards, e.g. 'site:github.com tag:design' or \"design -tag:old\""
      )
      .configureOutput(usageOutput(searchQuotingHint))
  ).action(async (query, options) =>
    writeCards(globals({ ...options, query: query || options.query }), "search")
  );

const similarBuilder: Build = (parent, name) =>
  withListOptions(
    parent
      .command(name)
      .argument("<id>")
      .description("List the cards closest in meaning to a card")
  ).action(async (id, options) =>
    writeCards(globals({ ...options, similarTo: id }), "similar")
  );

const createBuilder: Build = (parent, name) =>
  parent
    .command(name)
    .description("Save text, a link, or a file as a card")
    .argument(
      "[content]",
      "text, a URL, or a file path; reads stdin if omitted"
    )
    .option("--url <URL>", "save a link; any text becomes its content")
    .option("--file <PATH>", "upload a file")
    .option("--tags <tags>", "comma-separated tags")
    .option("--notes <notes>", "notes to add to the card")
    .option(
      "--source-url <URL>",
      "the page the text came from; it stays text, not a link"
    )
    .option("--source-title <title>", "the title of that page")
    .option(
      "--type <type>",
      "card type; omit to let Teak detect links, quotes, and palettes",
      parseType
    )
    .action(async (content, options) => createCard(content, globals(options)));

const deleteBuilder: Build = (parent, name) =>
  withDeleteOptions(
    parent
      .command(name)
      .argument("<ids...>")
      .description("Move cards to Trash, or delete them forever")
  ).action(async (ids, options) => deleteCards(ids, globals(options)));

const idsBuilder =
  (
    description: string,
    run: (ids: string[], options: GlobalOptions) => Promise<unknown>
  ): Build =>
  (parent, name) =>
    parent
      .command(name)
      .argument("<ids...>")
      .description(description)
      .action(async (ids) => {
        await run(ids, program.opts());
      });

const idBuilder =
  (
    description: string,
    run: (id: string, options: GlobalOptions) => Promise<unknown>
  ): Build =>
  (parent, name) =>
    parent
      .command(name)
      .argument("<id>")
      .description(description)
      .action(async (id) => {
        await run(id, program.opts());
      });

const contentBuilder: Build = (parent, name) =>
  parent
    .command(name)
    .argument("<id>")
    .description(
      "Print a card's text: its document's text or its transcript, or a link's article with --kind article"
    )
    .option(
      "--kind <kind>",
      `one kind of text: ${CONTENT_KINDS.join(", ")}`,
      oneOf("--kind", CONTENT_KINDS)
    )
    .action(async (id, options) => showCardContent(id, globals(options)));

const downloadBuilder: Build = (parent, name) =>
  parent
    .command(name)
    .argument("<id>")
    .description("Save a card's original file")
    .option(
      "-o, --output <PATH>",
      "where to save it; defaults to its file name"
    )
    .option("--force", "replace an existing file")
    .action(async (id, options) => downloadCard(id, globals(options)));

// `fav --remove`, `pin --remove` and `done --undo` are the old way to undo;
// they still work and point at unfav, unpin and todo.
const toggleBuilder =
  (input: {
    description: string;
    oldFlag?: { flags: string; key: string; replacement: string };
    run: (id: string, on: boolean, options: GlobalOptions) => Promise<void>;
    on: boolean;
  }): Build =>
  (parent, name) => {
    const command = parent
      .command(name)
      .argument("<id>")
      .description(input.description);
    const { oldFlag } = input;
    if (oldFlag) {
      command.addOption(
        new Option(
          oldFlag.flags,
          `old way to ${oldFlag.replacement}`
        ).hideHelp()
      );
    }
    return command.action(async (id, options) => {
      let on = input.on;
      if (oldFlag && options[oldFlag.key] === true) {
        warnDeprecated(
          `${oldFlag.flags} is now its own command: teak ${oldFlag.replacement} ${id}`
        );
        on = !on;
      }
      await input.run(id, on, globals(options));
    });
  };

const CARD_COMMANDS: Record<string, Build> = {
  list: listBuilder("List cards"),
  search: searchBuilder,
  similar: similarBuilder,
  trash: listBuilder("List cards in Trash", { trashed: true }),
  create: createBuilder,
  delete: deleteBuilder,
  restore: idsBuilder("Restore cards from Trash", restoreCards),
  refresh: idsBuilder(
    "Refresh summaries, tags and link previews for cards",
    refreshCards
  ),
  archive: idsBuilder(
    "Archive cards: hide them from the library without deleting",
    (ids, options) => setCardsArchived(ids, true, options)
  ),
  unarchive: idsBuilder(
    "Return archived cards to the library",
    (ids, options) => setCardsArchived(ids, false, options)
  ),
  content: contentBuilder,
  links: idBuilder(
    "List the cards a card links to with [[…]], and the cards linking to it",
    showCardLinks
  ),
  open: idBuilder("Open a card in Teak on the web", openCard),
  download: downloadBuilder,
  favorite: toggleBuilder({
    description: "Favorite a card",
    oldFlag: { flags: "--remove", key: "remove", replacement: "unfav" },
    on: true,
    run: favoriteCard,
  }),
  unfavorite: toggleBuilder({
    description: "Remove a card from favorites",
    on: false,
    run: favoriteCard,
  }),
  pin: toggleBuilder({
    description: `Pin a card to the top of the library (up to ${MAX_PINNED_CARDS})`,
    oldFlag: { flags: "--remove", key: "remove", replacement: "unpin" },
    on: true,
    run: pinCard,
  }),
  unpin: toggleBuilder({
    description: "Unpin a card",
    on: false,
    run: pinCard,
  }),
  done: toggleBuilder({
    description: "Mark a link read, watched, bought or done",
    oldFlag: { flags: "--undo", key: "undo", replacement: "todo" },
    on: true,
    run: markCardDone,
  }),
  todo: toggleBuilder({
    description: "Mark a link not done yet",
    on: false,
    run: markCardDone,
  }),
};

/** The top-level shortcuts and the `teak cards` command each one runs. */
export const SHORTCUTS: Record<string, string> = {
  ls: "list",
  search: "search",
  similar: "similar",
  trash: "trash",
  add: "create",
  rm: "delete",
  restore: "restore",
  refresh: "refresh",
  archive: "archive",
  unarchive: "unarchive",
  content: "content",
  links: "links",
  open: "open",
  download: "download",
  fav: "favorite",
  unfav: "unfavorite",
  pin: "pin",
  unpin: "unpin",
  done: "done",
  todo: "todo",
};

// The cards group's own aliases, so `teak cards ls` works like `teak ls`.
const CARD_ALIASES: Record<string, string> = {
  create: "add",
  delete: "rm",
  favorite: "fav",
  list: "ls",
  unfavorite: "unfav",
};

const build = (name: string): Build => {
  const builder = CARD_COMMANDS[name];
  if (!builder) {
    throw new Error(`No card command named ${name}`);
  }
  return builder;
};

const cards = program
  .command("cards")
  .description("List, search, create, and change cards");

const cardCommand = (name: string) => {
  const command = build(name)(cards, name);
  const alias = CARD_ALIASES[name];
  return alias ? command.alias(alias) : command;
};

cardCommand("list");
cardCommand("search");
cardCommand("similar");
withListOptions(
  cards.command("favorites").description("List favorite cards")
).action(async (options) => writeCards(globals(options), "favorites"));
const pins = withListOptions(
  cards
    .command("pins")
    .description("List the cards pinned to the top, first to last")
).action(async (options) => writeCards(globals(options), "pinned"));
pins
  .command("order")
  .argument("<ids...>", "every pinned card's id, first to last")
  .description("Reorder the pinned cards")
  .action(async (ids: string[], options) => {
    await reorderPins(ids, globals(options));
  });
cardCommand("trash");
cards
  .command("get")
  .argument("<id>")
  .description("Show a card's details")
  .action(async (id) => {
    const options = program.opts();
    const card = await client(options).cards.get(id);
    write(options.json ? card : formatDetail(card), options);
  });
cardCommand("create");
cards
  .command("update")
  .argument("<id>")
  .description(
    "Change a card's content, title, notes, link, tags, or palette colors"
  )
  .option("--content <text>", "new content, or - to read stdin")
  .option("--title <title>", 'card title; "" clears it')
  .option("--notes <notes>")
  .option("--url <URL>")
  .option("--tags <tags>", "replaces the card's own tags")
  .option(
    "--add-color <hex>",
    "add a color to a palette card; repeatable",
    collectPaletteColor
  )
  .option(
    "--remove-color <hex>",
    "remove a color from a palette card (before any --add-color); repeatable",
    collectPaletteColor
  )
  .action(async (id, options) => {
    const opts = globals(options);
    const card = await client(opts).cards.update(id, {
      addColors: options.addColor,
      removeColors: options.removeColor,
      content: await readContentOption(options.content),
      metadataTitle: options.title,
      notes: options.notes,
      tags: parseTags(options.tags),
      url: options.url,
    });
    write(opts.json ? card : formatCardLines([card]), opts);
  });
cardCommand("delete");
cardCommand("restore");
cardCommand("refresh");
cards
  .command("thumbnail")
  .argument("<id>", "a link card")
  .argument(
    "[file]",
    `a JPEG, PNG, WebP, GIF or AVIF image under ${formatBytes(THUMBNAIL_MAX_BYTES)}`
  )
  .description("Replace a link card's image, or reset it with --reset")
  .option("--reset", "go back to the image Teak found for the link")
  .action(async (id, file, options) =>
    setCardThumbnail(id, file, globals(options))
  );
cardCommand("archive");
cardCommand("unarchive");
cards
  .command("duplicate")
  .argument("<url>")
  .description(
    "Print the id of the card that saves this link (ignoring http/https, www., a trailing slash, a #fragment (but not a #/ or #! route) and utm_*, fbclid and gclid parameters); exits not found when none does"
  )
  .action(async (url) => findDuplicateCard(url, program.opts()));
cardCommand("content");
cardCommand("links");
cardCommand("open");
cardCommand("download");
cardCommand("favorite");
cardCommand("unfavorite");
cardCommand("pin");
cardCommand("unpin");
cardCommand("done");
cardCommand("todo");
cards
  .command("save-pdf")
  .argument("<id>")
  .description("Save an arXiv link's paper as a document card")
  .action(async (id, options) => {
    await savePdf(id, globals(options));
  });

const readBulkInput = async (file: string | undefined) =>
  file && file !== "-" ? readFileSync(file, "utf8") : await readStdin();

cards
  .command("bulk")
  .argument("<operation>", BULK_CARD_OPERATIONS.join(", "))
  .description(
    `Run one operation on up to ${PUBLIC_API_MAX_BULK_ITEMS} cards from a JSON file`
  )
  .option("--file <PATH>", "JSON items; - or no --file reads stdin")
  .addOption(new Option("--input <PATH>", "old name of --file").hideHelp())
  .option(
    "--dry-run",
    "check each item has the fields its operation needs; change nothing"
  )
  .action(async (operation, options) => {
    if (!BULK_OPERATIONS.includes(operation)) {
      throw new InvalidArgumentError(
        `operation must be one of: ${BULK_OPERATIONS.join(", ")}`
      );
    }
    if (options.input !== undefined) {
      warnDeprecated("--input is now --file");
    }
    const opts = globals(options);
    const items = bulkItems(
      readJson<unknown>(await readBulkInput(options.file ?? options.input))
    );
    if (!items) {
      throw new InvalidArgumentError(
        'bulk input must be a JSON array or {"items": [...]}'
      );
    }
    if (items.length === 0 || items.length > PUBLIC_API_MAX_BULK_ITEMS) {
      throw new InvalidArgumentError(
        `bulk input must have 1 to ${PUBLIC_API_MAX_BULK_ITEMS} items`
      );
    }
    if (options.dryRun) {
      const problems = items.flatMap((item, index) => {
        const message = bulkItemProblem(operation as BulkCardsOperation, item);
        return message ? [{ code: "INVALID_INPUT", index, message }] : [];
      });
      const noun = items.length === 1 ? "item" : "items";
      if (opts.json) {
        write({ dryRun: true, items: items.length, operation, problems }, opts);
      } else if (problems.length === 0) {
        write(
          `Would run ${operation} on ${items.length} ${noun}; each has the fields it needs. Nothing changed.`,
          opts
        );
      } else {
        process.stderr.write(
          `${[
            ...problems.map(
              (problem) =>
                `[${problem.index}] ${problem.code}: ${problem.message}`
            ),
            `${problems.length} of ${items.length} ${noun} would fail. Nothing changed.`,
          ].join("\n")}\n`
        );
      }
      if (problems.length > 0) {
        process.exitCode = EXIT.usage;
      }
      return;
    }
    const result = await client(opts).cards.bulk(
      operation as BulkCardsOperation,
      items,
      { idempotencyKey: `teak-cli-${randomUUID()}` }
    );
    if (result.summary.failed > 0) {
      process.exitCode = EXIT.api;
    }
    if (opts.json) {
      write(result, opts);
      return;
    }
    const lines = result.results.map((item, index) => ({
      failed: (item as { status?: unknown } | null)?.status !== "success",
      line: formatBulkResult(item, index),
    }));
    const done = lines.filter((item) => !item.failed);
    if (done.length > 0) {
      write(done.map((item) => item.line).join("\n"), opts);
    }
    process.stderr.write(
      `${[
        ...lines.filter((item) => item.failed).map((item) => item.line),
        `${result.summary.succeeded} of ${result.summary.total} items done${result.summary.failed > 0 ? `; ${result.summary.failed} failed` : ""}.`,
        ...((result.failedIds ?? []).length > 0
          ? [
              `Retry just the failed cards (${result.failedIds.join(" ")}) with their items in a new file.`,
            ]
          : []),
      ]
        .filter(Boolean)
        .join("\n")}\n`
    );
  });
cards
  .command("changes")
  .description("List cards changed since a time")
  .requiredOption(
    "--since <TIME>",
    "2026-01-01, 2026-01-01T09:30:00Z, 3d (3 days ago) or a millisecond timestamp",
    parseSince
  )
  .option("--next <CURSOR>", "continue from where the last page stopped")
  .addOption(hiddenCursorOption())
  .option("-n, --limit <NUMBER>", "how many cards per page", parseLimit)
  .action(async (options) => {
    const opts = globals(options);
    const result = await client(opts).cards.changes({
      cursor: cursorOption(options),
      limit: options.limit,
      since: options.since,
    });
    if (opts.json) {
      write(result, opts);
    } else {
      writeList(
        [
          ...(result.items.length ? [formatCardLines(result.items)] : []),
          ...result.deletedIds.map((id) => `deleted ${id}`),
        ],
        "No changes since then.",
        opts
      );
    }
    writeNextPage(result.pageInfo.nextCursor, opts);
  });

const tags = program
  .command("tags")
  .description("List tags")
  .action(async () => {
    await listTags(program.opts());
  });
tags
  .command("list")
  .description("List tags with how many cards use each")
  .action(async () => listTags(program.opts()));
tags
  .command("add")
  .description("Add tags to a card")
  .argument("<id>")
  .argument("<tags...>")
  .action(async (id, names) => editTags(id, names, "add", program.opts()));
tags
  .command("remove")
  .description("Remove tags from a card, including tags Teak added")
  .argument("<id>")
  .argument("<tags...>")
  .action(async (id, names) => editTags(id, names, "remove", program.opts()));
// `tags rm` was `tags remove`. Everywhere else rm deletes, so it's no longer
// listed; it still works and says so.
tags
  .command("rm", { hidden: true })
  .description("Old name of tags remove")
  .argument("<id>")
  .argument("<tags...>")
  .action(async (id, names) => {
    warnDeprecated("teak tags rm is now teak tags remove");
    await editTags(id, names, "remove", program.opts());
  });
withWaitOptions(
  tags
    .command("rename")
    .argument("<from>", "the tag to rename, in any capitalization")
    .argument("<to>", "the new name, as written")
    .description("Rename a tag on every card, including Trash and Archive")
    .option(
      "--dry-run",
      "say how many cards in your library have the tag; change nothing"
    ),
  "wait until every card has changed"
).action(async (from, to, options) =>
  startTagOperation("rename", from, to, globals(options))
);
withWaitOptions(
  tags
    .command("merge")
    .argument("<from>", "the tag to merge away")
    .argument("<into>", "the tag to keep")
    .description("Replace a tag with another on every card")
    .option(
      "--dry-run",
      "say how many cards in your library have the tag; change nothing"
    ),
  "wait until every card has changed"
).action(async (from, into, options) =>
  startTagOperation("merge", from, into, globals(options))
);
withWaitOptions(
  tags
    .command("delete")
    .argument("<tag>")
    .description("Remove a tag from every card; the cards are kept")
    .option(
      "--dry-run",
      "say how many cards in your library have the tag; change nothing"
    )
    .option("-y, --yes", "don't ask for confirmation"),
  "wait until every card has changed"
).action(async (tag, options) =>
  startTagOperation("delete", tag, undefined, globals(options))
);
withWaitOptions(
  tags
    .command("status")
    .argument("<operationId>")
    .description("Show how far a tag rename, merge, or delete got"),
  "wait until it finishes"
).action(async (id, options) => tagOperationStatus(id, globals(options)));

const parseFolderColor = oneOf("color", FOLDER_COLORS);
const collectString = (value: string, previous: string[] = []) => [
  ...previous,
  value,
];
const folders = program
  .command("folders")
  .description("List, create, and change folders")
  .action(async () => listFolders(program.opts()));
folders
  .command("list")
  .alias("ls")
  .description(
    "List folders with how many cards each holds; smart folders show their search"
  )
  .action(async () => listFolders(program.opts()));
folders
  .command("get")
  .alias("show")
  .argument("<folder>", "folder name or id")
  .description("Show one folder: its id, card count, name and smart search")
  .action(async (folder) => showFolder(folder, program.opts()));
folders
  .command("create")
  .argument("<name>")
  .description(
    "Create a folder, or with --query a smart folder that shows the cards matching a search"
  )
  .option("--color <color>", `${FOLDER_COLORS.join(", ")}`, parseFolderColor)
  .option(
    "--query <search>",
    "save a search as a smart folder, e.g. 'tag:design type:link'"
  )
  .option(
    "--auto-tag <tag>",
    "a tag every card put in the folder gets; repeatable",
    collectString
  )
  .option(
    "--auto-file <search>",
    "file cards that match this search into the folder, e.g. 'tag:fonts'"
  )
  .action(async (name, options) => createFolder(name, globals(options)));
withWaitOptions(
  folders
    .command("rules")
    .argument("<folder>", "folder name or id")
    .description(
      "Show or change a manual folder's rules: tags its cards get, and a search that files cards into it. New rules run over your existing cards"
    )
    .option(
      "--auto-tag <tag>",
      "replace the folder's tags with these; repeatable",
      collectString
    )
    .option("--no-auto-tags", "clear the folder's tags")
    .option("--auto-file <search>", "file cards that match this search")
    .option("--no-auto-file", "clear the auto-file search")
    .option("--pause", "pause the auto-file search")
    .option("--resume", "resume the auto-file search"),
  "wait until the rule run finishes"
).action(async (folder, options) => setFolderRules(folder, globals(options)));
withWaitOptions(
  folders
    .command("rule-run")
    .argument("<folder>", "folder name or id")
    .argument("[runId]", "a rule run id; the folder's latest by default")
    .description(
      "Show how far a folder rule run got and whether it can be undone"
    ),
  "wait until it finishes"
).action(async (folder, runId, options) =>
  folderRuleRunStatus(folder, runId, globals(options))
);
withWaitOptions(
  folders
    .command("undo-rule-run")
    .argument("<folder>", "folder name or id")
    .argument("[runId]", "a rule run id; the folder's latest by default")
    .description(
      "Undo a folder rule run within a day: take back the cards it filed and the tags it added"
    ),
  "wait until it finishes"
).action(async (folder, runId, options) =>
  undoFolderRuleRun(folder, runId, globals(options))
);
folders
  .command("rename")
  .argument("<folder>", "folder name or id")
  .argument("[name]", "new name")
  .description(
    "Rename a folder, change its color, or change a smart folder's search"
  )
  .option(
    "--color <color>",
    `${FOLDER_COLORS.join(", ")}, or none`,
    oneOf("color", [...FOLDER_COLORS, "none"])
  )
  .option("--query <search>", "a smart folder's new search")
  .action(async (folder, name, options) =>
    updateFolder(folder, name, globals(options))
  );
folders
  .command("delete")
  .alias("rm")
  .argument("<folders...>", "folder names or ids")
  .description("Delete folders; their cards are kept")
  .action(async (refs) => deleteFolders(refs, program.opts()));
folders
  .command("add")
  .argument("<folder>", "folder name or id")
  .argument("<ids...>", "card ids")
  .description("Add cards to a folder (smart folders refuse cards)")
  .action(async (folder, ids) =>
    changeFolderCards(folder, ids, "add", program.opts())
  );
folders
  .command("remove")
  .argument("<folder>", "folder name or id")
  .argument("<ids...>", "card ids")
  .description("Remove cards from a folder; the cards are kept")
  .action(async (folder, ids) =>
    changeFolderCards(folder, ids, "remove", program.opts())
  );

const highlights = program
  .command("highlights")
  .description("List, add, note and delete highlights in a link's article");
highlights
  .command("list")
  .alias("ls")
  .argument("<cardId>")
  .description(
    "List a link's highlights in article order, with their ids and notes"
  )
  .action(async (cardId) => listHighlights(cardId, program.opts()));
highlights
  .command("add")
  .argument("<cardId>")
  .argument("<quote>", "text from the link's saved article")
  .description(
    "Highlight a passage of a link's saved article, found by its text (the first match unless --prefix or --suffix points at another)"
  )
  .option("--note <text>", "a note on the highlight")
  .option("--prefix <text>", "text just before the quote")
  .option("--suffix <text>", "text just after the quote")
  .action(async (cardId, quote, options) =>
    addHighlight(cardId, quote, globals(options))
  );
highlights
  .command("note")
  .argument("<id>", "highlight id")
  .argument("[text]", "the note")
  .description("Write or change a highlight's note, or clear it with --clear")
  .option("--clear", "remove the note")
  .action(async (id, text, options) =>
    noteHighlight(id, text, globals(options))
  );
highlights
  .command("delete")
  .alias("rm")
  .argument("<ids...>", "highlight ids")
  .description("Delete highlights and their notes")
  .action(async (ids) => removeHighlights(ids, program.opts()));

const exportCommand = withWaitOptions(
  program
    .command("export")
    .description("Export every card and original file as a ZIP")
    .option("-o, --output <PATH>", "wait, then save the ZIP here")
    .option("--force", "replace an existing file"),
  "wait until the export is ready"
).action(async (options) => startExport(globals(options)));
exportCommand
  .command("status")
  .description("Show the latest export")
  .action(async () => exportStatus(program.opts()));
exportCommand
  .command("download")
  .description("Save the latest ready export")
  .option("-o, --output <PATH>", "where to save the ZIP")
  .option("--force", "replace an existing file")
  .action(async (_options, command: Command) =>
    downloadExport(command.optsWithGlobals())
  );

program
  .command("completion")
  .argument("<shell>", SHELLS.join(", "))
  .description("Print a shell completion script for teak")
  .action((shell: string) => {
    const name = oneOf("shell", SHELLS)(shell) as (typeof SHELLS)[number];
    process.stdout.write(`${completionScript(name)}\n`);
  });

// Top-level shortcuts, built by the same functions as their cards commands.
for (const [shortcut, name] of Object.entries(SHORTCUTS)) {
  const command = build(name)(program, shortcut);
  command.description(`${command.description()} (teak cards ${name})`);
}

addExamples(
  program,
  Object.fromEntries(
    Object.entries(SHORTCUTS).map(([shortcut, name]) => [
      shortcut,
      `cards ${name}`,
    ])
  )
);

// For errors: the command that ran and, when its first argument takes ids,
// what it was given.
const errorContext = () => {
  if (!activeCommand) {
    return {};
  }
  const first = activeCommand.registeredArguments[0]?.name();
  const value = activeCommand.processedArgs[0];
  const ids =
    first && /^(id|ids|cardId)$/.test(first)
      ? ([] as unknown[]).concat(value ?? []).map(String)
      : undefined;
  return { command: commandPath(activeCommand), ...(ids ? { ids } : {}) };
};

export const run = (argv = process.argv) => {
  // Shell completion asks what comes next; it runs no command.
  if (argv[2] === "__complete") {
    const candidates = completions(program, argv.slice(3));
    if (candidates.length > 0) {
      process.stdout.write(`${candidates.join("\n")}\n`);
    }
    return Promise.resolve();
  }
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
    const options = {
      ...program.opts(),
      json: program.opts().json === true || wantsJson(argv),
    };
    writeError(error, options, errorContext());
    process.exit(exitCodeFor(error));
  });
};

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  await run();
}
