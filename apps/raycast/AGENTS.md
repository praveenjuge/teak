# Raycast conventions

The `ray` CLI ships inside `@raycast/api` (there is no `@raycast/cli` npm
package); workspace scripts resolve it from the hoisted `node_modules/.bin`.

`build`, `lint`, `typecheck`, and `test` run headless. `dev` (`ray develop`)
additionally requires the Raycast macOS app installed, running, and signed in;
without it, develop compiles and then warns that Raycast is not running.
Install the app with `brew install --cask raycast`.

`package-lock.json` is intentionally committed: Raycast store CI runs `npm ci`
on the mirrored extension, so the lockfile must stay in sync with
`package.json`. Regenerate it from `apps/raycast` with
`npm install --package-lock-only --ignore-scripts --workspaces=false`. The
`--workspaces=false` flag prevents npm from traversing Bun workspace packages.
Then confirm lockstep versions still match.
