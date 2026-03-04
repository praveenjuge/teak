# Teak Desktop Updater Metadata

This folder is deployed as the `updates.teakvault.com` Vercel project.

`apps/updates` is a static site with updater metadata JSON files written by the
`Desktop Release` GitHub Action.

## Route Contract

- `GET /darwin/aarch64/latest.json`
- `GET /darwin/aarch64/:currentVersion.json`
- `GET /darwin/aarch64/:currentVersion` (rewritten to `.json` by `vercel.json`)

Each JSON file follows:

```json
{
  "version": "1.0.1",
  "notes": "Release notes",
  "pub_date": "2026-03-04T12:00:00Z",
  "url": "https://github.com/praveenjuge/teak/releases/download/v1.0.1/Teak.app.tar.gz",
  "signature": "<minisign-signature>"
}
```

Do not edit these JSON files manually. They are owned by CI release automation.
