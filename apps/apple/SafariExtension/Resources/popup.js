const title = document.getElementById("title");
const message = document.getElementById("message");
const signInButton = document.getElementById("sign-in");
const retryButton = document.getElementById("retry");
const signOutButton = document.getElementById("sign-out");

// The popup can't know the account's language before sign-in, so it follows the
// browser's: every label comes from `_locales` (generated from packages/i18n).
const t = (name) => browser.i18n.getMessage(name) || name;

const setState = (state, nextTitle, nextMessage) => {
  document.body.dataset.state = state;
  title.textContent = nextTitle;
  message.textContent = nextMessage;
};

const sendNative = async (payload) => {
  const response = await browser.runtime.sendNativeMessage(
    "com.praveenjuge.teak",
    { version: 1, ...payload }
  );
  if (!response || typeof response !== "object") {
    throw new Error(t("invalidResponse"));
  }
  return response;
};

const getActiveTabUrl = async () => {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.url || "";
};

const isSaveableUrl = (url) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

/** A native reply's text: Teak's own `code` in the popup's language, or the backend's `message`. */
const detail = (response, fallback) => {
  const known =
    typeof response.code === "string"
      ? browser.i18n.getMessage(response.code)
      : "";
  if (known) {
    return known;
  }
  return typeof response.message === "string" && response.message.trim()
    ? response.message
    : fallback;
};

const saveCurrentPage = async () => {
  setState("checking", "Teak", t("checkingSession"));

  const authState = await sendNative({ type: "getAuthState" });
  if (authState.status === "error") {
    setState(
      "error",
      t("unableToConnect"),
      detail(authState, t("pleaseTryAgain"))
    );
    return;
  }
  if (authState.authenticated !== true) {
    setState("signed-out", t("signInTitle"), t("signInMessage"));
    return;
  }

  const url = await getActiveTabUrl();
  if (!isSaveableUrl(url)) {
    setState("invalid", t("cannotSaveTitle"), t("openRegularWebsite"));
    return;
  }

  setState("saving", t("savingTitle"), t("savingMessage"));
  const saveResult = await sendNative({ type: "saveCurrentPage", url });
  if (saveResult.status === "saved") {
    setState("saved", t("savedTitle"), t("savedMessage"));
  } else if (saveResult.status === "duplicate") {
    setState("duplicate", t("duplicateTitle"), t("duplicateMessage"));
  } else if (saveResult.status === "unauthenticated") {
    setState(
      "signed-out",
      t("signInTitle"),
      detail(saveResult, t("signInMessage"))
    );
  } else {
    setState(
      "error",
      t("saveFailedTitle"),
      detail(saveResult, t("saveFailedMessage"))
    );
  }
};

const startSignIn = async () => {
  setState("checking", t("openingTeak"), t("completeSignIn"));
  const response = await sendNative({ type: "startSignIn" });
  if (response.status === "open-url" && typeof response.url === "string") {
    // iPhone and iPad: Safari opens Teak from a tab.
    await browser.tabs.create({ url: response.url });
  }
  if (response.status === "opening-app" || response.status === "open-url") {
    setState("checking", t("finishSignInTitle"), t("returnAfterSignIn"));
    return;
  }
  setState(
    "error",
    t("signInFailedTitle"),
    detail(response, t("signInFailedMessage"))
  );
};

const signOut = async () => {
  setState("checking", t("signingOutTitle"), t("oneMoment"));
  const response = await sendNative({ type: "signOut" });
  if (response.status !== "signed-out") {
    throw new Error(detail(response, t("signOutFailedMessage")));
  }
  setState("signed-out", t("signedOutTitle"), t("signInMessage"));
};

const run = async () => {
  try {
    await saveCurrentPage();
  } catch (error) {
    setState(
      "error",
      t("needsAccessTitle"),
      error instanceof Error ? error.message : t("needsAccessMessage")
    );
  }
};

if (document.documentElement) {
  document.documentElement.lang = browser.i18n.getUILanguage();
}
message.textContent = t("checkingSafari");
signInButton.textContent = t("signIn");
retryButton.textContent = t("tryAgain");
signOutButton.textContent = t("signOut");

signInButton.addEventListener("click", () => {
  startSignIn().catch((error) => {
    setState(
      "error",
      t("signInFailedTitle"),
      error instanceof Error ? error.message : t("tryAgainShort")
    );
  });
});

retryButton.addEventListener("click", () => {
  run();
});

signOutButton.addEventListener("click", () => {
  signOut().catch((error) => {
    setState(
      "error",
      t("signOutFailedTitle"),
      error instanceof Error ? error.message : t("tryAgainShort")
    );
  });
});

run();
