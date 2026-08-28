# Documentation conventions

## Changelog entries

`content/changelog` is a public product surface. Write for Teak users, not maintainers.

- Add an entry only when users can observe the change. Internal maintenance, dependencies, refactors, tests, CI, schemas, migrations, and build or release mechanics do not belong there.
- Describe the outcome in product language. Names users recognize, such as web, desktop, mobile, browser extension, Raycast, API, MCP, sync, settings, and sign-in, are appropriate.
- Keep one entry per date. Prefer updating the existing dated entry over creating a second one.
- Use one frontmatter title and one to three short bullets. Each bullet states one observable outcome in one or two sentences.
- Omit headings, fenced code, inline code, implementation details, and internal package or framework names.
- If users must act, state only the action they need to take.

An entry is complete when every bullet describes an observable user outcome and no implementation detail remains.
