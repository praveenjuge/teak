# Desktop reference workspace

The Electron app is unshipped as of 1.0.74. `apps/mac` is the supported Mac
app. Keep this source available for reference and local development. Package
versions remain in lockstep.

The app has no working sign-in. Its old Better Auth flow was removed when
Teak moved to WorkOS, so it always shows the signed-out screen.
`bun run dev desktop` starts the app, but you can't sign in.

Before it ships, it needs WorkOS sign-in: a loopback PKCE flow like the CLI's,
reusing the RFC 8252 callback server in `src/main/index.ts` (`oauth:listen`,
`oauth:cancel`, and the `oauth:callback` event in the preload bridge).

Releasing Electron again requires restoring its release workflow from git
history and following `RELEASE.md`. Do not ship it through the normal release
flow.
