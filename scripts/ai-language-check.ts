#!/usr/bin/env bun
/**
 * Live check for AI tags and summaries in the content's language (roadmap v3
 * phase 10). Reads the `ai-languages` seed pack's cards on the dev deployment
 * after processing and prints, for each card, the language it should be in,
 * the `aiLanguage` processing stored and whether the summary is in that
 * language's script, then the accuracy per language. Not part of
 * `bun run test`: it runs the dev deployment's Workers AI.
 *
 *   bun --no-env-file run scripts/ai-language-check.ts --seed --wait 15
 *   bun --no-env-file run scripts/ai-language-check.ts --workos-user user_01…
 *
 * It signs in as nobody: it runs `bunx convex run` in packages/convex, so it
 * needs the same Convex access as `bun run dev` (a Convex login or
 * CONVEX_DEPLOY_KEY). The account defaults to this checkout's dev account
 * (`.agents/.state/dev-account.json`, written by `bun run dev`).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { convexRunError, parseRunOutput } from "./convex-push-lease.ts";
import { stackStatePath } from "./lib/stack-state.ts";
import { runCommand } from "./proc.ts";

const ROOT = join(import.meta.dir, "..");
const CONVEX_DIR = join(ROOT, "packages/convex");
const ACCOUNT_PATH = join(dirname(stackStatePath(ROOT)), "dev-account.json");
const POLL_MS = 20_000;

/** The languages the release gate holds to `GATE_ACCURACY`. */
export const GATED_LANGUAGES = ["ja", "es", "de", "ko", "zh", "fr"] as const;
export const GATE_ACCURACY = 0.9;

export interface ReportRow {
  aiLanguage: string | null;
  aiSummary: string | null;
  aiTags: string[];
  cardId: string;
  expected: string | null;
  label: string;
  metadataStatus: string | null;
  type: string;
}

export type SummaryScript =
  | "arabic"
  | "cyrillic"
  | "devanagari"
  | "han"
  | "hangul"
  | "japanese"
  | "latin"
  | "none"
  | "other";

const SCRIPTS: [Exclude<SummaryScript, "japanese" | "none">, RegExp][] = [
  ["han", /\p{Script=Han}/u],
  ["hangul", /\p{Script=Hangul}/u],
  ["devanagari", /\p{Script=Devanagari}/u],
  ["arabic", /\p{Script=Arabic}/u],
  ["latin", /\p{Script=Latin}/u],
  ["cyrillic", /\p{Script=Cyrillic}/u],
];
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const LETTER = /\p{L}/u;

/**
 * The script most of a summary's letters are in. Japanese mixes Han and
 * kana, so any kana makes Han-and-kana text Japanese.
 */
export const summaryScript = (text: string | null): SummaryScript => {
  const counts = new Map<SummaryScript, number>();
  let kana = 0;
  for (const char of text ?? "") {
    if (!LETTER.test(char)) {
      continue;
    }
    if (KANA.test(char)) {
      kana += 1;
      continue;
    }
    const script = SCRIPTS.find(([, pattern]) => pattern.test(char))?.[0];
    const key = script ?? "other";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (kana > 0) {
    counts.set("japanese", kana + (counts.get("han") ?? 0));
    counts.delete("han");
  }
  let best: SummaryScript = "none";
  let bestCount = 0;
  for (const [script, count] of counts) {
    if (count > bestCount) {
      best = script;
      bestCount = count;
    }
  }
  return best;
};

const LANGUAGE_SCRIPTS: Record<string, SummaryScript> = {
  ar: "arabic",
  fa: "arabic",
  hi: "devanagari",
  ja: "japanese",
  ko: "hangul",
  mr: "devanagari",
  ru: "cyrillic",
  uk: "cyrillic",
  ur: "arabic",
  zh: "han",
};

/** The script a summary in this language is written in. */
export const expectedScript = (language: string): SummaryScript =>
  LANGUAGE_SCRIPTS[language] ?? "latin";

export interface LanguageScore {
  cards: number;
  language: string;
  languageMatches: number;
  scriptMatches: number;
}

/**
 * Accuracy per expected language, over every card in the pack. A card with
 * no summary yet (unfinished, failed or out of time) counts as a miss, so
 * failures can't lift a language over the bar.
 */
export const scoreRows = (rows: readonly ReportRow[]): LanguageScore[] => {
  const scores = new Map<string, LanguageScore>();
  for (const row of rows) {
    if (!row.expected) {
      continue;
    }
    const score = scores.get(row.expected) ?? {
      cards: 0,
      language: row.expected,
      languageMatches: 0,
      scriptMatches: 0,
    };
    score.cards += 1;
    if (row.aiLanguage === row.expected) {
      score.languageMatches += 1;
    }
    if (
      row.aiSummary &&
      summaryScript(row.aiSummary) === expectedScript(row.expected)
    ) {
      score.scriptMatches += 1;
    }
    scores.set(row.expected, score);
  }
  return [...scores.values()].sort((a, b) =>
    a.language.localeCompare(b.language)
  );
};

/** Gated languages under the bar (by language or by script), or with no cards. */
export const gateFailures = (scores: readonly LanguageScore[]): string[] =>
  GATED_LANGUAGES.filter((language) => {
    const score = scores.find((entry) => entry.language === language);
    return (
      !score ||
      score.languageMatches / score.cards < GATE_ACCURACY ||
      score.scriptMatches / score.cards < GATE_ACCURACY
    );
  });

const isUnfinished = (row: ReportRow) =>
  row.metadataStatus === "pending" || row.metadataStatus === "in_progress";

const percent = (part: number, whole: number) =>
  whole === 0 ? "-" : `${Math.round((part / whole) * 100)}%`;

const table = (header: string[], rows: string[][]): string => {
  const widths = header.map((cell, index) =>
    Math.max(cell.length, ...rows.map((row) => (row[index] ?? "").length))
  );
  const line = (row: string[]) =>
    row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ");
  return [
    line(header),
    line(widths.map((w) => "-".repeat(w))),
    ...rows.map(line),
  ].join("\n");
};

export const formatReport = (rows: readonly ReportRow[]): string => {
  const cards = table(
    [
      "card",
      "type",
      "expected",
      "aiLanguage",
      "summary script",
      "ok",
      "status",
    ],
    [...rows]
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((row) => {
        const script = summaryScript(row.aiSummary);
        const matches =
          row.expected !== null &&
          row.aiLanguage === row.expected &&
          script === expectedScript(row.expected);
        let ok = "-";
        if (row.aiSummary) {
          ok = matches ? "yes" : "NO";
        }
        return [
          row.label,
          row.type,
          row.expected ?? "?",
          row.aiLanguage ?? "-",
          row.aiSummary ? script : "-",
          ok,
          row.metadataStatus ?? "-",
        ];
      })
  );
  const scores = scoreRows(rows);
  const accuracy = table(
    ["language", "cards", "aiLanguage", "summary script", "gated"],
    scores.map((score) => [
      score.language,
      String(score.cards),
      percent(score.languageMatches, score.cards),
      percent(score.scriptMatches, score.cards),
      (GATED_LANGUAGES as readonly string[]).includes(score.language)
        ? "yes"
        : "",
    ])
  );
  return `${cards}\n\n${accuracy}`;
};

const convexRun = async (fn: string, args: Record<string, unknown>) => {
  const result = await runCommand(
    ["bunx", "convex", "run", fn, JSON.stringify(args)],
    { cwd: CONVEX_DIR, timeoutMs: 120_000 }
  );
  if (result.exitCode !== 0) {
    throw new Error(`${fn}: ${convexRunError(result.stderr)}`);
  }
  return parseRunOutput(result.stdout);
};

const readWorkosUser = (given: string | undefined): string => {
  if (given) {
    return given;
  }
  if (existsSync(ACCOUNT_PATH)) {
    const saved = JSON.parse(readFileSync(ACCOUNT_PATH, "utf-8")) as {
      workosUserId?: string;
    };
    if (saved.workosUserId) {
      return saved.workosUserId;
    }
  }
  throw new Error(
    "No dev account: run `bun run dev --detach` first, or pass --workos-user."
  );
};

const main = async () => {
  const { values } = parseArgs({
    options: {
      seed: { type: "boolean", default: false },
      wait: { type: "string", default: "0" },
      "workos-user": { type: "string" },
    },
  });
  const workosUserId = readWorkosUser(values["workos-user"]);
  if (values.seed) {
    const seeded = await convexRun("devSeed:seedScenario", {
      scenario: "ai-languages",
      workosUserId,
    });
    console.log(`Seed: ${JSON.stringify(seeded)}`);
  }
  const deadline = Date.now() + Number(values.wait) * 60_000;
  let rows: ReportRow[] = [];
  for (;;) {
    rows = (await convexRun("devSeed/aiLanguages:report", {
      workosUserId,
    })) as ReportRow[];
    const unfinished = rows.filter(isUnfinished).length;
    if (unfinished === 0 || Date.now() >= deadline) {
      if (unfinished > 0) {
        console.log(`${unfinished} card(s) still processing.`);
      }
      break;
    }
    console.log(`Waiting for ${unfinished} card(s) to finish processing…`);
    await Bun.sleep(POLL_MS);
  }
  if (rows.length === 0) {
    console.log(
      "No ai-languages cards on this account. Seed them with --seed."
    );
    process.exit(1);
  }
  console.log(formatReport(rows));
  const failures = gateFailures(scoreRows(rows));
  console.log(
    failures.length === 0
      ? `\nGate passed: ${GATED_LANGUAGES.join(", ")} at ${GATE_ACCURACY * 100}% or more.`
      : `\nGate not met for: ${failures.join(", ")} (needs ${GATE_ACCURACY * 100}% or more).`
  );
  process.exit(failures.length === 0 ? 0 : 1);
};

if (import.meta.main) {
  await main();
}
