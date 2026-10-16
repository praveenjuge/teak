#!/usr/bin/env bun
/**
 * Measures the Clef decisions on hand-labelled fixtures, with the Files
 * Worker's own prompts (apps/files-worker/src/decisions.ts), through the
 * Workers AI REST API. Prints precision, coverage and accuracy per threshold,
 * latency and tokens, so `DECISION_THRESHOLDS` (packages/files-protocol) can
 * be tuned. Not part of `bun run test`: it calls a paid model.
 *
 *   CLOUDFLARE_API_TOKEN=… bun --no-env-file run scripts/clef-eval/run.ts --feature link-category
 *   … --feature link-category --model clef-flash
 *   … --feature card-type | visual-styles | relevance
 *
 * The token needs Workers AI Read on the Teak account.
 */
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { parseArgs } from "node:util";
import {
  buildCardTypeRequest,
  buildLinkCategoryRequest,
  buildRelevanceRequest,
  buildVisualStylesRequest,
  type ClefReply,
  type ClefRequest,
  runClef,
  VISUAL_STYLE_QUESTION_PREFIX,
} from "../../apps/files-worker/src/decisions";
import type { FilesOpsEnv } from "../../apps/files-worker/src/ops";
import { normalizeQuoteContent } from "../../packages/convex/card/quoteFormatting";
import { VISUAL_STYLE_TAXONOMY } from "../../packages/convex/shared/constants";
import { resolveLinkCategory } from "../../packages/convex/shared/utils/linkCategoryResolver";
import { textCardRulesType } from "../../packages/convex/workflows/steps/classification";
import {
  CLEF_INPUT_USD_PER_MILLION,
  CLEF_MODEL_IDS,
  type ClefModel,
  DECISION_THRESHOLDS,
} from "../../packages/files-protocol/src/index";
import { CLOUDFLARE_ACCOUNT_ID } from "../files-worker-dev-boundary";
import {
  type ChoiceOutcome,
  choiceRows,
  median,
  ndcgAt,
  percentile,
  type StyleOutcome,
  styleBreakdown,
  styleRows,
} from "./metrics";

const FEATURES = [
  "link-category",
  "card-type",
  "visual-styles",
  "relevance",
] as const;
type Feature = (typeof FEATURES)[number];

const { values } = parseArgs({
  options: {
    feature: { type: "string" },
    model: { type: "string" },
  },
});
const feature = values.feature as Feature;
if (!FEATURES.includes(feature)) {
  throw new Error(`--feature must be one of ${FEATURES.join(", ")}`);
}
const modelOverride = values.model as ClefModel | undefined;
if (modelOverride && !(modelOverride in CLEF_MODEL_IDS)) {
  throw new Error("--model must be clef or clef-flash");
}
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) {
  throw new Error("Export CLOUDFLARE_API_TOKEN (Workers AI Read)");
}

const fixtures = join(import.meta.dir, "fixtures");
const readJson = <T>(name: string): T =>
  JSON.parse(readFileSync(join(fixtures, name), "utf8")) as T;

/** A Workers AI binding over the REST API, as `runClef` expects. */
const env = {
  AI: {
    run: async (model: string, body: Record<string, unknown>) => {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }
      );
      const json = (await response.json()) as {
        errors?: { code?: number; message?: string }[];
        result?: unknown;
        success?: boolean;
      };
      if (!(response.ok && json.success)) {
        const error = json.errors?.[0];
        throw Object.assign(
          new Error(error?.message ?? `workers_ai_${response.status}`),
          { code: error?.code, status: response.status }
        );
      }
      return json.result;
    },
  },
} as unknown as FilesOpsEnv;

const latencies: number[] = [];
let inputTokens = 0;
let calls = 0;

const ask = async (request: ClefRequest): Promise<ClefReply> => {
  const startedAt = performance.now();
  const reply = await runClef(env, {
    ...request,
    ...(modelOverride ? { model: modelOverride } : {}),
  });
  latencies.push(performance.now() - startedAt);
  inputTokens += reply.usage?.inputTokens ?? 0;
  calls += 1;
  return reply;
};

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

const printChoiceRows = (
  outcomes: ChoiceOutcome[],
  current: number,
  never: string[] = []
) => {
  console.log("| threshold | changed | precision | coverage | accuracy |");
  console.log("| --- | --- | --- | --- | --- |");
  for (const row of choiceRows(outcomes, never)) {
    const marker = row.threshold === current ? " (current)" : "";
    console.log(
      `| ${row.threshold}${marker} | ${row.changed} | ${percent(row.precision)} | ${percent(row.coverage)} | ${percent(row.accuracy)} |`
    );
  }
  const rulesAccuracy =
    outcomes.filter((item) => item.rules === item.label).length /
    Math.max(1, outcomes.length);
  const clefAccuracy =
    outcomes.filter((item) => item.choice === item.label).length /
    Math.max(1, outcomes.length);
  console.log(
    `\nRules alone: ${percent(rulesAccuracy)}. Clef's top answer alone: ${percent(clefAccuracy)}.`
  );
};

const runLinkCategory = async () => {
  const items = readJson<
    {
      description?: string;
      jsonLdTypes?: string[];
      label: string;
      siteName?: string;
      title?: string;
      url: string;
    }[]
  >("link-categories.json");
  const outcomes: ChoiceOutcome[] = [];
  let skipped = 0;
  for (const item of items) {
    const rules = resolveLinkCategory(item.url, {
      siteName: item.siteName,
      title: item.title || item.description,
    });
    // Production asks Clef only below the domain and path rules.
    if (rules.reason === "domain_rule" || rules.reason === "path_rule") {
      skipped += 1;
      continue;
    }
    const { request } = buildLinkCategoryRequest({
      ...item,
      rulesCategory: rules.category,
    });
    const answer = (await ask(request)).answers.category;
    if (answer?.type === "choice") {
      outcomes.push({
        choice: answer.choice,
        label: item.label,
        probability: answer.probabilities[answer.choice] ?? 0,
        rules: rules.category,
      });
    }
  }
  console.log(
    `Link category: ${outcomes.length} links (${skipped} skipped: a domain or path rule decides them).\n`
  );
  printChoiceRows(outcomes, DECISION_THRESHOLDS.linkCategory, ["other"]);
};

const runCardType = async () => {
  const items =
    readJson<{ content: string; label: string; savedAs?: "text" }[]>(
      "card-types.json"
    );
  const outcomes: ChoiceOutcome[] = [];
  let skipped = 0;
  for (const item of items) {
    // Saved with no type, quoted text is a quote from creation and never
    // reaches Clef (`resolveCreatedCardType`); `savedAs: "text"` is a note a
    // client saved as text, which Clef does review.
    if (
      item.savedAs !== "text" &&
      normalizeQuoteContent(item.content).removedQuotes
    ) {
      skipped += 1;
      continue;
    }
    const rulesType = textCardRulesType(item);
    const { request } = buildCardTypeRequest({
      content: item.content,
      rulesType,
    });
    const answer = (await ask(request)).answers.type;
    if (answer?.type === "choice") {
      outcomes.push({
        choice: answer.choice,
        label: item.label,
        probability: answer.probabilities[answer.choice] ?? 0,
        rules: rulesType,
      });
    }
  }
  console.log(
    `Card type: ${outcomes.length} notes (${skipped} skipped: quotes from creation).\n`
  );
  printChoiceRows(outcomes, DECISION_THRESHOLDS.cardType);
};

const IMAGE_TYPES: Record<string, string> = {
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const runVisualStyles = async () => {
  const folder = join(fixtures, "visual-styles");
  const labels = readJson<Record<string, unknown>>("visual-styles/labels.json");
  const outcomes: StyleOutcome[] = [];
  for (const file of readdirSync(folder)) {
    const contentType = IMAGE_TYPES[extname(file).toLowerCase()];
    const fileLabels = labels[file];
    if (!(contentType && Array.isArray(fileLabels))) {
      continue;
    }
    const bytes = readFileSync(join(folder, file));
    const reply = await ask(
      buildVisualStylesRequest(
        `data:${contentType};base64,${bytes.toString("base64")}`
      )
    );
    const probabilities: Record<string, number> = {};
    for (const style of VISUAL_STYLE_TAXONOMY) {
      const answer = reply.answers[`${VISUAL_STYLE_QUESTION_PREFIX}${style}`];
      probabilities[style] = answer?.type === "noul" ? answer.noul : 0;
    }
    outcomes.push({ labels: fileLabels as string[], probabilities });
  }
  if (outcomes.length === 0) {
    console.log(
      "No labelled images: add some to scripts/clef-eval/fixtures/visual-styles (see labels.json)."
    );
    return;
  }
  console.log(`Visual styles: ${outcomes.length} images.\n`);
  console.log("| threshold | precision | recall | F1 |");
  console.log("| --- | --- | --- | --- |");
  for (const row of styleRows(outcomes)) {
    const marker =
      row.threshold === DECISION_THRESHOLDS.visualStyle ? " (current)" : "";
    console.log(
      `| ${row.threshold}${marker} | ${percent(row.precision)} | ${percent(row.recall)} | ${row.f1.toFixed(3)} |`
    );
  }
  console.log(
    `\nPer style at the current threshold (${DECISION_THRESHOLDS.visualStyle}):\n`
  );
  console.log("| style | labelled | predicted | precision | recall |");
  console.log("| --- | --- | --- | --- | --- |");
  for (const row of styleBreakdown(outcomes, DECISION_THRESHOLDS.visualStyle)) {
    console.log(
      `| ${row.style} | ${row.labelled} | ${row.predicted} | ${percent(row.precision)} | ${percent(row.recall)} |`
    );
  }
};

const runRelevance = async () => {
  const { cards, queries } = readJson<{
    cards: { createdAt: number; id: string; text: string }[];
    queries: {
      fused: string[];
      query: string;
      relevance: Record<string, number>;
    }[];
  }>("search.json");
  const byId = new Map(cards.map((card) => [card.id, card]));
  const totals = { fused: 0, newest: 0, scored: 0 };
  for (const item of queries) {
    const candidates = item.fused.flatMap((id) => {
      const card = byId.get(id);
      return card ? [card] : [];
    });
    const { request } = buildRelevanceRequest({
      query: item.query,
      cards: candidates.map((card) => ({ id: card.id, text: card.text })),
    });
    const reply = await ask(request);
    const scores = new Map(
      candidates.map((card, index) => {
        const answer = reply.answers[`card.${index}`];
        return [card.id, answer?.type === "score" ? answer.score : 0];
      })
    );
    const scored = [...item.fused].sort(
      (left, right) => (scores.get(right) ?? 0) - (scores.get(left) ?? 0)
    );
    const newest = [...candidates]
      .sort((left, right) => right.createdAt - left.createdAt)
      .map((card) => card.id);
    totals.fused += ndcgAt(item.fused, item.relevance);
    totals.scored += ndcgAt(scored, item.relevance);
    totals.newest += ndcgAt(newest, item.relevance);
  }
  const count = Math.max(1, queries.length);
  console.log(`Best match: ${queries.length} searches, nDCG@10.\n`);
  console.log("| order | nDCG@10 |");
  console.log("| --- | --- |");
  console.log(`| Best match (Clef) | ${(totals.scored / count).toFixed(3)} |`);
  console.log(`| Fused search order | ${(totals.fused / count).toFixed(3)} |`);
  console.log(`| Newest first | ${(totals.newest / count).toFixed(3)} |`);
};

const runners: Record<Feature, () => Promise<void>> = {
  "card-type": runCardType,
  "link-category": runLinkCategory,
  relevance: runRelevance,
  "visual-styles": runVisualStyles,
};

await runners[feature]();

const model =
  CLEF_MODEL_IDS[
    modelOverride ??
      (feature === "link-category" ? "clef" : ("clef-flash" as ClefModel))
  ];
const cost =
  (inputTokens * (CLEF_INPUT_USD_PER_MILLION[model] ?? 0)) / 1_000_000;
console.log(
  `\n${calls} calls on ${model}: median ${median(latencies).toFixed(0)} ms, p95 ${percentile(latencies, 95).toFixed(0)} ms, ${inputTokens} input tokens, $${cost.toFixed(5)} (≈ $${((cost / Math.max(1, calls)) * 1000).toFixed(3)} per 1,000 calls).`
);
