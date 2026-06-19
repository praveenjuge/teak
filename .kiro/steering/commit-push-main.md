---
inclusion: manual
description: "Inspects the current git changes, generates a conventional commit message based on the diff, honors git hooks and fixes failures, then pushes to the current branch (main, master, or otherwise)."
---

Commit the current working tree and push to the current branch on origin.

Steps:
1. Run `git status --short` and `git diff --stat HEAD` to see what has changed. If there are no changes, stop and tell the user there is nothing to commit.
2. Run `git diff HEAD` (and `git diff --cached` if anything is staged) to understand the substance of the changes. For new/untracked files, read them directly to understand intent.
3. Determine the current branch with `git rev-parse --abbrev-ref HEAD`. Use this branch for the push target — it may be `main`, `master`, or any other branch. Do not assume a specific branch name.
4. Generate a concise Conventional Commits style message:
   - Subject line under 70 characters in the form `type(scope): summary` (types: feat, fix, chore, docs, refactor, test, style, perf, build, ci).
   - Add a short body only if multiple unrelated changes need explanation. Keep it to a few bullet points.
   - Base the message on what actually changed, not just file names.
5. Stage all changes with `git add -A`, then commit using a heredoc or `-F -` so multi-line messages work cleanly.
6. NEVER pass `--no-verify`. Pre-commit and commit-msg hooks must run.
7. If a git hook fails (lint errors, formatting issues, type errors, failing tests, etc.):
   - Read the hook output carefully to understand the failure.
   - Fix the underlying problems directly in the code. Do not bypass with `--no-verify`.
   - If a formatter/linter auto-modified files, re-stage them with `git add -A` and retry the commit.
   - Retry the commit up to 3 times. If it still fails after genuine fix attempts, stop and report what went wrong so the user can decide.
   - Do not make cosmetic or no-op changes just to get past a failing hook.
8. Push to the current branch:
   - Check if the branch has an upstream with `git rev-parse --abbrev-ref --symbolic-full-name @{u}` (or `git status -sb`).
   - If an upstream is set, run `git push`.
   - If no upstream is set, run `git push -u origin <current-branch>`.
   - If the push is rejected (non-fast-forward, branch protection, hook failure), report the error and stop rather than forcing.
9. Before committing, flag any staged files that look like they contain secrets (`.env`, credentials, private keys, tokens) and confirm with the user before proceeding.

Report the branch name, final commit hash, and push result when done.
