# Shared release preparation

Last reviewed: 2026-11-01

Every Teak product release starts from one next-patch version change. The
preferred path is one command from the repository root:

```bash
bun run release:prepare <version>
```

It validates the next patch, updates every tracked `package.json`, the Safari
WebExtension manifest, the MCP registry's `server.json`, the Claude plugin's
`plugins/teak/.claude-plugin/plugin.json`, and the Apple app's
marketing version, synchronizes
`bun.lock` (and `apps/raycast/package-lock.json` when present),
then verifies with a frozen install and the lockstep validator. Review the
diff and commit every package manifest and lockfile together as one scoped
version change. The command is resume-safe: if a run fails partway, re-run
it with the same version plus `--resume` to continue from the install step.

Manual fallback (same steps the script performs):

1. Update the `version` field in every tracked `package.json` to the same next patch version.
2. Update `apps/apple/SafariExtension/Resources/manifest.json`, `server.json`, `plugins/teak/.claude-plugin/plugin.json`, `MARKETING_VERSION` in `apps/apple/project.yml`, and every `MARKETING_VERSION` in the generated `apps/apple/Teak.xcodeproj/project.pbxproj` to the same version. Leave `CURRENT_PROJECT_VERSION` alone: the Apple release workflow sets the build number from App Store Connect.
3. Run `bun install` from the repository root to synchronize `bun.lock`.
4. From `apps/raycast`, run `npm install --package-lock-only --ignore-scripts --workspaces=false` to synchronize both version fields in `package-lock.json` without traversing the Bun workspace packages.
5. From the repository root, run `bun install --frozen-lockfile` and `node scripts/release/release-version.ts lockstep <version>`. Both commands must exit successfully without changing files.
6. Commit every package manifest, Apple version source, `bun.lock`, and `apps/raycast/package-lock.json` together as one scoped version change.

The preparation is complete when the working tree contains the intended version-only diff and the lockstep validator confirms every package manifest, npm lockfile, and Apple version source uses the target version.

Keep published version tags immutable. The `Version Tag` workflow creates the tag after the version change reaches `main`; do not create or move it manually during the normal release path.

Release scripts that workflows run with plain `node`, often before Bun is installed (`scripts/release/release-version.ts`, `apple-*`, `sdk-release`, `watch-release-run`), are dependency-free TypeScript that Node runs directly (type stripping, so only erasable syntax and `.ts` import extensions). Every job that runs one sets up the pinned Node from `package.json` first; `scripts/release/package.json` marks the folder as ES modules. Every other script in `scripts/` runs with Bun.

## CLI

The npm package is `teak-cli`; the installed binary is `teak`. After the
shared preparation:

1. Merge the scoped version change to `main`.
2. `.github/workflows/version-tag.yml` verifies the patch and lockstep
   invariants, creates `v<version>`, and dispatches
   `.github/workflows/cli-release.yml`, which tests, builds and publishes the
   package to npm with provenance.
3. Check that the workflow succeeded and `npm view teak-cli@<version> version`
   returns the version.

Don't create or move the version tag by hand on the normal release path.

## Public SDK publication

`SDK Release` publishes `teak-sdk` from the same next-patch lockstep tag as
the other products. Branch dispatches, mismatched tags, and commits outside
`main` are rejected. The workflow installs and exercises the packed SDK in
an independent consumer before publishing the exact tarball with provenance.
The tarball is packed from `packages/sdk/dist`, which
`bun run --cwd packages/sdk build` fills with the bundle, the declarations and
the published `package.json`.
Retries verify both npm metadata and the downloaded tarball against that
artifact; only an explicit registry version 404 permits publication.

The first SDK release uses the same next-patch lockstep tag. npm requires an
existing package before configuring trust. With explicit approval, use the
isolated local npm login to stage the reviewed SDK tarball and reserve its name.
npm creates a public `0.0.0-stage` placeholder; do not approve the staged SDK
version. Configure trusted publishing for repository `praveenjuge/teak`, workflow
`sdk-release.yml`, environment `npm-sdk-release`, allowing direct publication.
Restrict that GitHub environment to version tags without required human review.
The first real release and all later releases publish automatically through OIDC with verified provenance.
No npm credential is stored in GitHub, and no token fallback is supported.

Account setup requires separate approval. See
[npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/) and
[staged publishing](https://docs.npmjs.com/staged-publishing/).

To retry, dispatch `SDK Release` on the existing immutable version tag.
An already published version passes only when its bytes match. A conflict,
registry outage, or failed verification requires investigation; never move
the tag or overwrite a published version.

## MCP Registry and Claude directory

`server.json` describes Teak's remote MCP server for the official MCP Registry
(`registry.modelcontextprotocol.io`) under the name `com.teakvault/mcp`, which
the registry checks against a DNS record on `teakvault.com`. The Claude plugin
in `plugins/teak` and its connector listing are covered by
`.agents/runbooks/claude-directory.md`; the directory picks up a new plugin version
from `main` on its own.

One-time setup (done 31 Oct 2026, first published as 1.0.91):

1. Generate an Ed25519 key (`openssl genpkey -algorithm Ed25519 -out key.pem`)
   and keep `key.pem` in the password manager, never in the repository.
2. Add the TXT record `v=MCPv1; k=ed25519; p=<public key>` on the apex
   `teakvault.com`, where the public key is
   `openssl pkey -in key.pem -pubout -outform DER | tail -c 32 | base64`.

3. Store the key's 32-byte seed, as hex, in the repository secret
   `MCP_PRIVATE_KEY`:

   ```bash
   openssl pkey -in key.pem -outform DER | tail -c 32 | xxd -p -c 64 | gh secret set MCP_PRIVATE_KEY -R praveenjuge/teak
   ```

Every version tag then publishes through
`.github/workflows/mcp-registry-release.yml`, which `Version Tag` waits for
like the other products. It checks that `server.json` carries the tag's
version, skips a version the registry already lists, verifies the pinned
`mcp-publisher` with cosign, logs in with `login dns --domain teakvault.com`,
publishes, and confirms the version at
`https://registry.modelcontextprotocol.io/v0/servers/com.teakvault%2Fmcp/versions/<version>`.
A run without `MCP_PRIVATE_KEY` fails and names this section.

To publish by hand instead, from the repository root with `mcp-publisher`
from the registry's releases:

```bash
PRIVATE_KEY="$(openssl pkey -in key.pem -outform DER | tail -c 32 | xxd -p -c 64)"
mcp-publisher login dns --domain teakvault.com --private-key "$PRIVATE_KEY"
mcp-publisher publish
```

The registry refuses a version it already has, so a missed version can only
be skipped; the next release publishes the next one.
