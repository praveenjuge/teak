# Pull requests

Teak's repository is public, so every PR title, body, comment, and linked image is public. Fill `.github/pull_request_template.md` and follow these rules for anything you post on GitHub.

## Title and body

- Title: a conventional commit, `type(scope): outcome`, for example `fix(web): steady grid selection`. Scopes match the workspace (`web`, `extension`, `convex`, `docs`, `plans`, `admin`...).
- Fill the template's sections in order. Delete sections that don't apply and every HTML comment; leave no empty headings or placeholders.
- Write for a reviewer who hasn't seen the session: the user-visible outcome first, then the detail they need to review the diff. Name files, functions, and tables in backticks when they help.
- Report verification faithfully: the commands you ran and what they returned, the `verify-teak` features you drove and what you observed, and anything you could not check and why.
- Keep the tool attribution lines the agent harness adds; add nothing else about the session.

## Never in a PR

- Secrets of any kind: API keys, deploy keys, tokens, cookies, passwords, signing secrets, webhook URLs, or env var values. Name a new env var, never its value.
- Real user data: emails, names, card content, IP addresses, analytics `distinct_id`s, or account IDs from production. Describe counts and patterns instead ("3 events from one device").
- Names of people, employers, clients, customers, or other companies, and their internal products, projects, or URLs. Services this codebase already integrates with (Convex, WorkOS, PostHog, Polar, Cloudflare...) are fine when the change touches them.
- Links a reviewer can't open, internal hostnames, or local machine paths outside the repository. The one exception is the session's private artifact page under Proof, which the owner can open.
- Raw logs or traces pasted without reading them. Trim them to the lines that matter and redact anything above.

## Screenshots and video

- Capture only the local or dev stack, signed in as the seeded account, with seeded or mock cards. Never capture production or a real account.
- Before you link a file, look at every screenshot and scrub through every video. Crop or recapture when a frame shows any of: other browser tabs, bookmarks, or extensions; notifications; devtools with cookies, storage, or request headers; a terminal with env output; or anything from the list above.
- Cover the states the change touches: empty, loading, populated, and error; light and dark; 390px and 1440px for UI.
- For API, CLI, and MCP changes, use captured request and response or terminal output instead, with tokens replaced by `<redacted>`.
- Host the files outside the repository. Never commit screenshots or videos to the branch only to show them in the PR. Publish them as a private artifact page from the session and link it under Proof (the owner can open it; the PR text must still stand on its own without it). When you can't publish, send them to the owner and summarize them in text. Agents can't upload GitHub PR attachments, which only the web UI accepts.

## Before you post

Re-read the full title and body as a stranger would, and tick the template's "Safe to publish" boxes only once each one is true. When in doubt about a detail, leave it out and tell the owner in the session instead.
