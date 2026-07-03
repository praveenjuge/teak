import { resolveTeakDevAppUrl } from "@teak/convex/dev-urls";
import { MESSAGE_TYPES } from "../types/messages";

const COMPLETE_PATHNAME = "/native/auth/complete";

// Match patterns ignore ports, and `import.meta.env.DEV` is a build-time
// constant (WXT executes this module to read the config), so production ships
// only the exact prod pattern while dev also matches the local app host. The
// `*://` scheme covers both http and the https that portless serves locally
// (the app upgrades http->https), and the runtime pathname guard in main()
// scopes the dev host pattern to the completion page.
const buildMatches = (): string[] => {
  const prodPattern = "https://app.teakvault.com/native/auth/complete*";
  if (!import.meta.env.DEV) {
    return [prodPattern];
  }
  const devHost = new URL(resolveTeakDevAppUrl(import.meta.env)).hostname;
  return [prodPattern, `*://${devHost}/*`];
};

export default defineContentScript({
  matches: buildMatches(),
  main() {
    if (window.location.pathname !== COMPLETE_PATHNAME) {
      return;
    }

    const state = new URLSearchParams(window.location.search).get("state");
    if (!state) {
      return;
    }

    // Ping the background so it can immediately poll for the freshly authorized
    // code. The popup-open poll is the fallback if this handshake misfires.
    chrome.runtime
      .sendMessage({
        type: MESSAGE_TYPES.NATIVE_AUTH_COMPLETED,
        payload: { state },
      })
      .catch(() => {
        // Background may not be listening yet; the popup fallback covers it.
      });
  },
});
