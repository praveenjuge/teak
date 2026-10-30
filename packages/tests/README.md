# Teak E2E tests

[e2e](https://e2e.tester.army/docs) journeys across Teak's web app, REST API, CLI and MCP server, run against this checkout's own local stack (`src/stack/`): the WorkOS emulator, a local Convex backend, the Core Worker in local mode, and the web app. It needs no secrets.

```bash
bun run --cwd packages/tests e2e
```

How to run it, the suites, how the stack is wired and what it doesn't cover: [teakvault.com/docs/testing](https://teakvault.com/docs/testing#end-to-end-suite) (`apps/docs/content/docs/(open-source)/testing.mdx`).
