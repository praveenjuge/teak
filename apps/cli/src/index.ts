import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CARD_TYPES,
  type CardSort,
  isCardType,
  parseTags,
  TeakApiError,
} from "@teak/convex/sdk";
import { Command, InvalidArgumentError } from "commander";
import { addCard, readStdin } from "./files";
import { formatCardLine, formatDetail } from "./format";
import {
  type ClientOptions,
  clearCredentials,
  client,
  EXIT,
  exitCodeFor,
  type GlobalOptions,
  login,
  readCredentials,
  readJson,
  VERSION,
  write,
  writeError,
} from "./runtime";

export { mimeFor, typeForMime } from "./files";
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

export const parseSort = (value: string): CardSort => {
  if (!(value === "newest" || value === "oldest")) {
    throw new InvalidArgumentError("sort must be newest or oldest");
  }
  return value;
};

const queryOptions = (options: Record<string, unknown>) => {
  const sort: CardSort | undefined =
    options.sort === "newest" || options.sort === "oldest"
      ? options.sort
      : undefined;
  return {
    createdAfter:
      typeof options.createdAfter === "string"
        ? Number(options.createdAfter)
        : undefined,
    createdBefore:
      typeof options.createdBefore === "string"
        ? Number(options.createdBefore)
        : undefined,
    cursor: typeof options.cursor === "string" ? options.cursor : undefined,
    favorited: options.favorited === true,
    include: typeof options.include === "string" ? options.include : undefined,
    limit: typeof options.limit === "number" ? options.limit : undefined,
    query: typeof options.query === "string" ? options.query : undefined,
    sort,
    tag: typeof options.tag === "string" ? options.tag : undefined,
    type: typeof options.type === "string" ? options.type : undefined,
  };
};

const withListOptions = (command: Command) =>
  command
    .option("-q, --query <text>")
    .option("--type <type>", "card type", parseType)
    .option("--tag <tag>")
    .option("--favorited")
    .option("--limit <n>", "result limit", parseLimit)
    .option("--cursor <cursor>")
    .option("--sort <sort>", "newest or oldest", parseSort)
    .option("--created-after <ms>")
    .option("--created-before <ms>")
    .option("--include <groups>")
    .option("--all");

const renderCardsPage = async (
  options: ClientOptions & Record<string, unknown>
) => {
  const api = client(options);
  const first = await api.cards.list(queryOptions(options));
  if (!(options.all && first.pageInfo.nextCursor)) {
    return first;
  }
  const items = [...first.items];
  let cursor: string | null = first.pageInfo.nextCursor;
  while (cursor) {
    const page = await api.cards.list({ ...queryOptions(options), cursor });
    items.push(...page.items);
    cursor = page.pageInfo.nextCursor;
  }
  return { items, pageInfo: { hasMore: false, nextCursor: null } };
};

const writeCards = async (options: ClientOptions & Record<string, unknown>) => {
  const page = await renderCardsPage(options);
  write(
    options.json ? page : page.items.map(formatCardLine).join("\n"),
    options
  );
  if (!(options.json || page.pageInfo.nextCursor === null)) {
    process.stderr.write(`nextCursor: ${page.pageInfo.nextCursor}\n`);
  }
};

const deleteCards = async (ids: string[], options: GlobalOptions) => {
  for (const id of ids) {
    await client(options).cards.delete(id);
  }
  write(
    options.json
      ? { deletedIds: ids }
      : ids
          .map(
            (id) =>
              `Deleted ${id} (moved to trash - restore at app.teakvault.com)`
          )
          .join("\n"),
    options
  );
};

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

const program = new Command()
  .name("teak")
  .description("Command line client for Teak")
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

program.command("logout").action(() => {
  clearCredentials();
  write("Logged out of Teak.", program.opts());
});

program
  .command("auth")
  .command("status")
  .action(async () => {
    const options = program.opts();
    let source = "none";
    if (options.apiKey || process.env.TEAK_API_KEY) {
      source = "api-key";
    } else if (readCredentials()) {
      source = process.platform === "darwin" ? "keychain" : "file";
    }
    if (source === "none") {
      throw new TeakApiError("AUTH_REQUIRED");
    }
    await client(options).tags.list();
    write(
      options.json ? { source, status: "ok" } : `Authenticated via ${source}.`,
      options
    );
  });

const cards = program.command("cards");
withListOptions(cards.command("list").alias("ls")).action(async (options) =>
  writeCards({ ...program.opts(), ...options })
);
withListOptions(cards.command("search").argument("[query]")).action(
  async (query, options) => {
    const opts = { ...program.opts(), ...options };
    const result = await client(opts).cards.search({
      ...queryOptions(options),
      query: query || options.query,
    });
    write(
      opts.json ? result : result.items.map(formatCardLine).join("\n"),
      opts
    );
  }
);
withListOptions(cards.command("favorites")).action(async (options) => {
  const opts = { ...program.opts(), ...options };
  const result = await client(opts).cards.favorites(queryOptions(options));
  write(opts.json ? result : result.items.map(formatCardLine).join("\n"), opts);
});
cards
  .command("get")
  .argument("<id>")
  .action(async (id) => {
    const options = program.opts();
    const card = await client(options).cards.get(id);
    write(options.json ? card : formatDetail(card), options);
  });
cards
  .command("create")
  .alias("add")
  .argument("[content]")
  .option("--url <url>")
  .option("--file <path>")
  .option("--tags <tags>")
  .option("--notes <notes>")
  .action(async (content, options) =>
    createCard(content, { ...program.opts(), ...options })
  );
cards
  .command("update")
  .argument("<id>")
  .option("--content <text>")
  .option("--notes <notes>")
  .option("--url <url>")
  .option("--tags <tags>")
  .action(async (id, options) => {
    const opts = { ...program.opts(), ...options };
    const card = await client(opts).cards.update(id, {
      content: options.content,
      notes: options.notes,
      tags: parseTags(options.tags),
      url: options.url,
    });
    write(opts.json ? card : formatCardLine(card), opts);
  });
cards
  .command("delete")
  .alias("rm")
  .argument("<ids...>")
  .action(async (ids) => {
    await deleteCards(ids, program.opts());
  });
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

withListOptions(program.command("ls")).action(async (options) =>
  writeCards({ ...program.opts(), ...options })
);
withListOptions(program.command("search").argument("[query]")).action(
  async (query, options) => {
    const opts = { ...program.opts(), ...options };
    const result = await client(opts).cards.search({
      ...queryOptions(options),
      query: query || options.query,
    });
    write(
      opts.json ? result : result.items.map(formatCardLine).join("\n"),
      opts
    );
  }
);
program
  .command("add")
  .argument("[content]")
  .option("--url <url>")
  .option("--file <path>")
  .option("--tags <tags>")
  .option("--notes <notes>")
  .action(async (content, options) =>
    createCard(content, { ...program.opts(), ...options })
  );
program
  .command("rm")
  .argument("<ids...>")
  .action(async (ids) => {
    await deleteCards(ids, program.opts());
  });
program
  .command("fav")
  .argument("<id>")
  .option("--remove")
  .action(async (id, options) => {
    await favoriteCard(id, options.remove, { ...program.opts(), ...options });
  });

export const run = (argv = process.argv) => {
  program.exitOverride();
  return program.parseAsync(argv).catch((error) => {
    if (typeof error?.exitCode === "number" && error.exitCode === 0) {
      process.exit(0);
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
