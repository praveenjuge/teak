import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FOLDER_COLORS } from "@teak/convex/shared/folders";
import { randomShuffleSeed } from "@teak/convex/shared/search/shuffle";
import { Command, CommanderError, InvalidArgumentError } from "commander";
import {
  type BulkCardsOperation,
  type CardsPage,
  parseTags,
  TeakApiError,
} from "teak-sdk";
import { addCard, readStdin } from "./files";
import { formatCardLine, formatDetail } from "./format";
import {
  authStatus,
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
  listFolders,
  openCard,
  refreshCards,
  resolveFolder,
  restoreCards,
  setCardsArchived,
  setCardThumbnail,
  showCardContent,
  showCardLinks,
  showFolder,
  startExport,
  startTagOperation,
  tagOperationStatus,
  updateFolder,
  whoami,
} from "./library";
import {
  oneOf,
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
} from "./runtime";

export { getUploadFileInfo, mimeFor } from "./files";
export { formatCardLine } from "./format";
export {
  parseDateRange,
  parseMode,
  parseSeed,
  parseSort,
  queryOptions,
} from "./options";

type ListMode = "list" | "search" | "favorites" | "similar";

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
    if (mode === "similar" && input.similarTo) {
      const { similarTo, ...rest } = input;
      return api.cards.similar(similarTo, rest);
    }
    return mode === "search" ? api.cards.search(input) : api.cards.list(input);
  };
  const page = await collectPages(fetchPage, options.all === true);
  write(
    options.json
      ? listingJson(
          page,
          options.sort === "shuffle"
            ? (shuffleSeed ?? (options.seed as number | undefined))
            : undefined
        )
      : page.items.map(formatCardLine).join("\n"),
    options
  );
  if (!(options.json || page.pageInfo.nextCursor === null)) {
    process.stderr.write(`nextCursor: ${page.pageInfo.nextCursor}\n`);
  }
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

const markCardDone = async (
  id: string,
  undo: boolean,
  options: GlobalOptions
) => {
  const card = await client(options).cards.setDone(id, !undo);
  write(options.json ? card : formatCardLine(card), options);
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
  write(options.json ? result : `${result.cardId}  ${result.appUrl}`, options);
};

const BULK_OPERATIONS: readonly string[] = [
  "create",
  "update",
  "favorite",
  "delete",
  "restore",
  "archive",
  "unarchive",
  "addTags",
  "removeTags",
] satisfies BulkCardsOperation[];

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
    status?: unknown;
  };
  const index = typeof item.index === "number" ? item.index : position;
  if (item.status === "success") {
    return `[${index}] ${String(item.cardId ?? "ok")}`;
  }
  const message = typeof item.error === "string" ? item.error : "failed";
  return `[${index}] ${typeof item.code === "string" ? `${item.code}: ` : ""}${message}`;
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
export const program = new Command()
  .name("teak")
  .description("Command line client for Teak")
  .exitOverride()
  .version(VERSION)
  .option("--api-key <key>", "Teak API key")
  .option("--api-url <url>", "Teak API base URL", process.env.TEAK_API_URL)
  .option("--json", "emit JSON");

program
  .command("login")
  .description("Sign in to Teak in your browser")
  .option("--no-browser", "print the sign-in URL instead of opening it")
  .action(async (options) =>
    write(await login({ ...program.opts(), ...options }), program.opts())
  );

program
  .command("logout")
  .description("Sign out and disconnect the CLI")
  .action(async () => {
    write(await logout(program.opts()), program.opts());
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

const withAddOptions = (command: Command) =>
  command
    .argument(
      "[content]",
      "text, a URL, or a file path; reads stdin if omitted"
    )
    .option("--url <url>", "save a link; any text becomes its content")
    .option("--file <path>", "upload a file")
    .option("--tags <tags>", "comma-separated tags")
    .option("--notes <notes>", "notes to add to the card")
    .option(
      "--source-url <url>",
      "the page the text came from; it stays text, not a link"
    )
    .option("--source-title <title>", "the title of that page")
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

const cards = program
  .command("cards")
  .description("List, search, create, and change cards");
withListOptions(
  cards.command("list").alias("ls").description("List cards")
).action(async (options) => writeCards({ ...program.opts(), ...options }));
withListOptions(
  cards
    .command("search")
    .argument("[query]")
    .description("Search cards, e.g. 'site:github.com tag:design'")
).action(async (query, options) =>
  writeCards(
    { ...program.opts(), ...options, query: query || options.query },
    "search"
  )
);
withListOptions(
  cards
    .command("similar")
    .argument("<id>")
    .description("List the cards closest in meaning to a card")
).action(async (id, options) =>
  writeCards({ ...program.opts(), ...options, similarTo: id }, "similar")
);
withListOptions(
  cards.command("favorites").description("List favorite cards")
).action(async (options) =>
  writeCards({ ...program.opts(), ...options }, "favorites")
);
withListOptions(
  cards.command("trash").description("List cards in Trash")
).action(async (options) =>
  writeCards({ ...program.opts(), ...options, trashed: true })
);
cards
  .command("get")
  .argument("<id>")
  .description("Show a card's details")
  .action(async (id) => {
    const options = program.opts();
    const card = await client(options).cards.get(id);
    write(options.json ? card : formatDetail(card), options);
  });
withAddOptions(
  cards
    .command("create")
    .alias("add")
    .description("Save text, a link, or a file as a card")
);
cards
  .command("update")
  .argument("<id>")
  .description("Change a card's content, title, notes, link, or tags")
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
  cards
    .command("delete")
    .alias("rm")
    .argument("<ids...>")
    .description("Move cards to Trash, or delete them forever")
).action(async (ids, options) =>
  deleteCards(ids, { ...program.opts(), ...options })
);
cards
  .command("restore")
  .argument("<ids...>")
  .description("Restore cards from Trash")
  .action(async (ids) => restoreCards(ids, program.opts()));
cards
  .command("refresh")
  .argument("<ids...>")
  .description("Refresh summaries, tags and link previews for cards")
  .action(async (ids) => refreshCards(ids, program.opts()));
cards
  .command("thumbnail")
  .argument("<id>", "a link card")
  .argument("[file]", "a JPEG, PNG, WebP, GIF or AVIF image under 20 MB")
  .description("Replace a link card's image, or reset it with --reset")
  .option("--reset", "go back to the image Teak found for the link")
  .action(async (id, file, options) =>
    setCardThumbnail(id, file, { ...program.opts(), ...options })
  );
cards
  .command("archive")
  .argument("<ids...>")
  .description("Archive cards: hide them from the library without deleting")
  .action(async (ids) => setCardsArchived(ids, true, program.opts()));
cards
  .command("unarchive")
  .argument("<ids...>")
  .description("Return archived cards to the library")
  .action(async (ids) => setCardsArchived(ids, false, program.opts()));
cards
  .command("duplicate")
  .argument("<url>")
  .description(
    "Print the id of the card that saves this URL; exits not found when none does"
  )
  .action(async (url) => findDuplicateCard(url, program.opts()));
cards
  .command("content")
  .argument("<id>")
  .description("Print a card's text: its document's text or its transcript")
  .action(async (id) => showCardContent(id, program.opts()));
cards
  .command("links")
  .argument("<id>")
  .description(
    "List the cards a card links to with [[…]], and the cards linking to it"
  )
  .action(async (id) => showCardLinks(id, program.opts()));
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
  .description("Favorite a card")
  .option("--remove", "remove it from favorites")
  .action(async (id, options) => {
    await favoriteCard(id, options.remove, { ...program.opts(), ...options });
  });
cards
  .command("done")
  .argument("<id>")
  .description("Mark a link read, watched, bought or done")
  .option("--undo", "mark it not done")
  .action(async (id, options) => {
    await markCardDone(id, options.undo === true, {
      ...program.opts(),
      ...options,
    });
  });
cards
  .command("save-pdf")
  .argument("<id>")
  .description("Save an arXiv link's paper as a document card")
  .action(async (id, options) => {
    await savePdf(id, { ...program.opts(), ...options });
  });
cards
  .command("bulk")
  .argument(
    "<operation>",
    "create, update, favorite, delete, restore, archive, unarchive, addTags, or removeTags"
  )
  .description("Run one operation on up to 100 cards from a JSON file")
  .option("--input <file>", "JSON items; reads stdin when omitted")
  .action(async (operation, options) => {
    if (!BULK_OPERATIONS.includes(operation)) {
      throw new InvalidArgumentError(
        `operation must be one of: ${BULK_OPERATIONS.join(", ")}`
      );
    }
    const opts = { ...program.opts(), ...options };
    const raw = options.input
      ? readFileSync(options.input, "utf8")
      : await readStdin();
    const items = bulkItems(readJson<unknown>(raw));
    if (!items) {
      throw new InvalidArgumentError(
        'bulk input must be a JSON array or {"items": [...]}'
      );
    }
    const result = await client(opts).cards.bulk(
      operation as BulkCardsOperation,
      items
    );
    write(
      opts.json
        ? result
        : [
            `${result.summary.succeeded}/${result.summary.total} succeeded`,
            ...result.results.map(formatBulkResult),
          ].join("\n"),
      opts
    );
    if (result.summary.failed > 0) {
      process.exitCode = EXIT.api;
    }
  });
cards
  .command("changes")
  .description("List cards changed since a timestamp")
  .requiredOption("--since <ms>", "millisecond timestamp", parseSince)
  .option("--cursor <cursor>")
  .option("--limit <n>", "result limit", parseLimit)
  .action(async (options) => {
    const opts = { ...program.opts(), ...options };
    const result = await client(opts).cards.changes(options);
    write(
      opts.json
        ? result
        : [
            ...result.items.map(formatCardLine),
            ...result.deletedIds.map((id) => `deleted ${id}`),
          ].join("\n"),
      opts
    );
    if (!(opts.json || result.pageInfo.nextCursor === null)) {
      process.stderr.write(`nextCursor: ${result.pageInfo.nextCursor}\n`);
    }
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
  .command("rm")
  .alias("remove")
  .description("Remove tags from a card, including tags Teak added")
  .argument("<id>")
  .argument("<tags...>")
  .action(async (id, names) => editTags(id, names, "remove", program.opts()));
tags
  .command("rename")
  .argument("<from>", "the tag to rename, in any capitalization")
  .argument("<to>", "the new name, as written")
  .description("Rename a tag on every card, including Trash and Archive")
  .option("--wait", "wait until every card has changed")
  .action(async (from, to, options) =>
    startTagOperation("rename", from, to, { ...program.opts(), ...options })
  );
tags
  .command("merge")
  .argument("<from>", "the tag to merge away")
  .argument("<into>", "the tag to keep")
  .description("Replace a tag with another on every card")
  .option("--wait", "wait until every card has changed")
  .action(async (from, into, options) =>
    startTagOperation("merge", from, into, { ...program.opts(), ...options })
  );
tags
  .command("delete")
  .argument("<tag>")
  .description("Remove a tag from every card; the cards are kept")
  .option("--wait", "wait until every card has changed")
  .option("-y, --yes", "don't ask for confirmation")
  .action(async (tag, options) =>
    startTagOperation("delete", tag, undefined, {
      ...program.opts(),
      ...options,
    })
  );
tags
  .command("status")
  .argument("<operationId>")
  .description("Show how far a tag rename, merge, or delete got")
  .option("--wait", "wait until it finishes")
  .action(async (id, options) =>
    tagOperationStatus(id, { ...program.opts(), ...options })
  );

const parseFolderColor = oneOf("color", FOLDER_COLORS);
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
  .action(async (name, options) =>
    createFolder(name, { ...program.opts(), ...options })
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
    updateFolder(folder, name, { ...program.opts(), ...options })
  );
folders
  .command("rm")
  .alias("delete")
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
  .action(async (_options, command: Command) =>
    downloadExport(command.optsWithGlobals())
  );

withListOptions(program.command("ls").description("List cards")).action(
  async (options) => writeCards({ ...program.opts(), ...options })
);
withListOptions(
  program
    .command("search")
    .argument("[query]")
    .description("Search cards, e.g. 'site:github.com tag:design'")
).action(async (query, options) =>
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
withListOptions(
  program
    .command("similar")
    .argument("<id>")
    .description("List the cards closest in meaning to a card")
).action(async (id, options) =>
  writeCards({ ...program.opts(), ...options, similarTo: id }, "similar")
);
withAddOptions(
  program.command("add").description("Save text, a link, or a file as a card")
);
withDeleteOptions(
  program
    .command("rm")
    .argument("<ids...>")
    .description("Move cards to Trash, or delete them forever")
).action(async (ids, options) =>
  deleteCards(ids, { ...program.opts(), ...options })
);
program
  .command("restore")
  .argument("<ids...>")
  .description("Restore cards from Trash")
  .action(async (ids) => restoreCards(ids, program.opts()));
program
  .command("links")
  .argument("<id>")
  .description(
    "List the cards a card links to with [[…]], and the cards linking to it"
  )
  .action(async (id) => showCardLinks(id, program.opts()));
program
  .command("content")
  .argument("<id>")
  .description("Print a card's text: its document's text or its transcript")
  .action(async (id) => showCardContent(id, program.opts()));
program
  .command("refresh")
  .argument("<ids...>")
  .description("Refresh summaries, tags and link previews for cards")
  .action(async (ids) => refreshCards(ids, program.opts()));
program
  .command("archive")
  .argument("<ids...>")
  .description("Archive cards: hide them from the library without deleting")
  .action(async (ids) => setCardsArchived(ids, true, program.opts()));
program
  .command("unarchive")
  .argument("<ids...>")
  .description("Return archived cards to the library")
  .action(async (ids) => setCardsArchived(ids, false, program.opts()));
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
  .description("Favorite a card")
  .option("--remove", "remove it from favorites")
  .action(async (id, options) => {
    await favoriteCard(id, options.remove, { ...program.opts(), ...options });
  });
program
  .command("done")
  .argument("<id>")
  .description("Mark a link read, watched, bought or done")
  .option("--undo", "mark it not done")
  .action(async (id, options) => {
    await markCardDone(id, options.undo === true, {
      ...program.opts(),
      ...options,
    });
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
