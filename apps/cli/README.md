# Teak CLI

Command-line client for [Teak](https://teakvault.com), the personal knowledge hub for saving and rediscovering ideas, links, files, notes, and references.

## Install

```bash
npm install -g teak-cli
```

```bash
teak --version
```

## Sign In

```bash
teak login
```

The CLI opens Teak in your browser and stores the resulting session securely in macOS Keychain when available. You can also use an API key:

```bash
teak --api-key teakapi_... cards list
```

## Common Commands

```bash
teak add "Design note from today's review" --tags design,research
teak add --url https://example.com --tags reference
teak add --file ./screenshot.png --notes "Homepage inspiration"
teak search "homepage inspiration"
teak cards list --type link --hue blue --date "last week"
teak cards get <card-id>
teak open <card-id>
teak download <card-id>
teak tags add <card-id> approved
teak fav <card-id>
teak rm <card-id>
teak trash
teak restore <card-id>
teak export -o teak-backup.zip
teak whoami
```

Use `--json` on any command for script-friendly output.

## Docs

- CLI guide: [teakvault.com/docs/cli](https://teakvault.com/docs/cli)
- API docs: [teakvault.com/docs/api](https://teakvault.com/docs/api)
- MCP docs: [teakvault.com/docs/mcp](https://teakvault.com/docs/mcp)
