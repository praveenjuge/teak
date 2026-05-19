# Teak for Safari Release Process

Use this when the user asks to release Teak for Safari.

Teak for Safari is the macOS Safari extension app in `apps/safari-extension/`
and ships through App Store Connect app `6770003409`. The release version comes
from the root `package.json`.

## Agent Rule

When the user says to release a Safari version, treat that as approval to:

1. Bump every tracked `package.json` to the next patch version.
2. Commit the release change.
3. Push `main`.
4. Create and push the matching `v<version>` tag.
5. Wait for the Safari GitHub Action to finish.
6. Update the App Store version with the correct user-facing release notes.
7. Attach the newest processed build if needed.
8. Add the version for review and submit it to App Review.

Stop only for real blockers: failed checks, failed GitHub Action, Apple
login/2FA, missing secrets, missing processed build, or App Store Connect
validation errors.

## Release Steps

### 1. Bump versions

Patch-bump every tracked `package.json` in the monorepo:

```bash
next="$(node -e "const v=require('./package.json').version.split('.').map(Number); v[2]+=1; console.log(v.join('.'))")"
NEXT_VERSION="$next" node - <<'NODE'
const fs = require('fs');
const { execSync } = require('child_process');
const next = process.env.NEXT_VERSION;
for (const file of execSync("git ls-files 'package.json' 'apps/*/package.json' 'packages/*/package.json'", { encoding: 'utf8' }).trim().split('\\n')) {
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  json.version = next;
  fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\\n`);
}
NODE
```

Then confirm:

```bash
rg '"version": "' package.json apps/*/package.json packages/*/package.json
```

All versions must match.

### 2. Write App Store release notes

Review user-visible changes since the last Safari release:

```bash
git log --oneline "$(git describe --tags --abbrev=0)"..HEAD -- apps/safari-extension packages/convex apps/web
```

Write short App Store release notes for the macOS version. Keep them marketing
and user-facing only. Do not mention code, frameworks, build tooling, App Store
automation, signing, tests, backend services, tokens, App Groups, native
messaging, keychain storage, or permissions.

If there are no user-visible Safari changes, use:

```text
IMPROVED: Small fixes and polish to keep saving pages from Safari smooth and reliable.
```

### 3. Validate

Run:

```bash
bun run pre-commit
xcodebuild -list -project apps/safari-extension/teak-safari.xcodeproj
```

### 4. Commit, push, and tag

Use a conventional commit:

```bash
version="$(node -p "require('./package.json').version")"
git add package.json apps/*/package.json packages/*/package.json
git commit -m "chore: release v$version"
git push origin main
git tag "v$version"
git push origin "v$version"
```

### 5. Wait for GitHub Actions

Watch the Safari release workflow until it reaches a terminal state:

```bash
gh run list --workflow safari-extension-release.yml --limit 5
gh run watch <run-id> --exit-status
```

The workflow uploads the Mac App Store package to App Store Connect and attaches
`teak-safari-<version>-mac-app-store.pkg` to the GitHub Release.

### 6. Submit in App Store Connect

Open:

```text
https://appstoreconnect.apple.com/apps/6770003409/distribution/macos/version/inflight
```

Before submitting:

- Set the version's release notes to the user-facing notes from step 2.
- Confirm the newest processed build for this version is selected.
- Confirm the screenshots are still present.
- Keep release type as manual unless the user asks for automatic release.
- Click **Add for Review**.
- Resolve any validation errors.
- Open **App Review** and submit the item.

If App Store Connect says **Newer Build Available**, cancel the prompt, remove
the older selected build, attach the newest processed build, save, and submit
again.

## Constants

- App Store Connect app id: `6770003409`
- macOS version page:
  `https://appstoreconnect.apple.com/apps/6770003409/distribution/macos/version/inflight`
- Privacy policy: `https://teakvault.com/docs/privacy-policy/`
