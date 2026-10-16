# Clef eval

Measures the Clef decisions (link category, card type, visual styles and Best
match) on the hand-labelled fixtures in `fixtures/`, using the Files Worker's
own prompts from `apps/files-worker/src/decisions.ts`. Use it before changing a
prompt or a threshold in `DECISION_THRESHOLDS`
(`packages/files-protocol/src/decisions.ts`), and bump that decision's
`DECISION_VERSIONS` entry when you do.

```bash
export CLOUDFLARE_API_TOKEN=…   # Workers AI Read on the Teak account
bun --no-env-file run scripts/clef-eval/run.ts --feature link-category
bun --no-env-file run scripts/clef-eval/run.ts --feature link-category --model clef-flash
bun --no-env-file run scripts/clef-eval/run.ts --feature card-type
bun --no-env-file run scripts/clef-eval/run.ts --feature visual-styles
bun --no-env-file run scripts/clef-eval/run.ts --feature relevance
```

It calls a paid model (a few cents for every fixture) and is not part of
`bun run test`. `metrics.test.ts` covers the scoring it prints.

## Reading the tables

- **precision**: of the answers Clef changed, how many were right.
- **coverage**: of the rules' mistakes, how many Clef fixed.
- **accuracy**: the answers people would see, Clef's or the rules'.

Pick the lowest threshold that keeps precision at 95% or more for link
category and card type, with coverage of at least 30% (link category) or 50%
(card type). For styles, pick the best F1 with precision at 85% and recall at
50% or more. A decision that can't meet both bars stays off: set its threshold
to 1.

## Fixtures

- `link-categories.json`: links on made-up sites, as the resolver sees them.
  Links a domain or path rule decides are skipped, as in production.
- `card-types.json`: notes, quotations with and without quote marks, palettes,
  and code or dialogue that only looks like one.
- `search.json`: a small library and searches with graded relevance (0 to 3);
  `fused` is the order the search returns before Best match.
- `visual-styles/`: add your own or CC0 images and label them in
  `labels.json`. Images are not committed.

Every fixture is made up. Never add real cards or anything from a real
account.
