# scripts

Repository scripts, grouped by what they're for. Each test sits beside the
script it covers. The folder is the `@teak/scripts` workspace, so Turbo runs
its `typecheck`, `lint` and `test` tasks with the rest (`bun run verify`,
`bun run test`). Its tests also run the TypeScript checks in `apps/apple/tests`
and `apps/android/tests`, which have no workspace of their own. Because the
repository checks in `repo/` read the whole tree, the `test` task's inputs
(`turbo.json`) are every file in the repository outside build output, so any
change reruns them.

Other workspaces import these modules as `@teak/scripts/<path>` (for example
`@teak/scripts/dev/worktree-env`), so Turbo sees the dependency.

| Folder | What's there |
| --- | --- |
| `dev/` | `bun run dev` and the stack it runs: ports per worktree, the push lease, the Core Worker in development, smoke checks, cloud Docker helpers |
| `setup/` | `bun run setup` and `bun run doctor` |
| `env/` | The environment contract, its loader and targets, and the env and dotenv audits |
| `release/` | Release preparation, the lockstep version checks, and the scripts release workflows run with plain `node` |
| `cloudflare/` | Cloudflare checks and config: R2 lifecycle, WAF rules, the workflow RPC secret |
| `repo/` | Repository-wide checks: guide paths, skills, pinned actions, lockfiles, parity between surfaces |
| `seed/` | The demo account seed and the AI language check for seeded cards |
| `lib/` | Helpers several scripts share |
| `lint/` | Biome GritQL rules |
| `docs-assets/`, `store-assets/` | Docs screenshots and store screenshots |
| `clef-eval/` | Measures the Core Worker's AI decisions (link category, card type, visual styles) on labelled fixtures |
| `fixtures/` | Test fixtures |

Scripts in `release/` must run on the pinned Node without Bun: no
dependencies, only erasable TypeScript (`erasableSyntaxOnly` in
`tsconfig.json`), and `.ts` extensions on imports. Their shared argument and
JSON helpers, and `pollUntil` for every bounded release wait, are in
`release/release-cli.ts`.
