const title = document.getElementById("title");
const message = document.getElementById("message");
const signInButton = document.getElementById("sign-in");
const retryButton = document.getElementById("retry");
const signOutButton = document.getElementById("sign-out");

const setState = (state, nextTitle, nextMessage) => {
    document.body.dataset.state = state;
    title.textContent = nextTitle;
    message.textContent = nextMessage;
};

const sendNative = async (payload) => {
    const response = await browser.runtime.sendNativeMessage("com.praveenjuge.teak-safari", {
        version: 1,
        ...payload,
    });

    if (!response || typeof response !== "object") {
        throw new Error("Teak returned an invalid response.");
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

const saveCurrentPage = async () => {
    setState("checking", "Teak", "Checking session...");

    const authState = await sendNative({ type: "getAuthState" });
    if (authState.authenticated !== true) {
        setState("signed-out", "Sign in to Teak", "Sign in to save pages.");
        return;
    }

    const url = await getActiveTabUrl();
    if (!isSaveableUrl(url)) {
        setState("invalid", "Cannot save this page", "Open a regular website and try again.");
        return;
    }

    setState("saving", "Saving page", "Sending this page to Teak...");

    const saveResult = await sendNative({ type: "saveCurrentPage", url });
    if (saveResult.status === "saved") {
        setState("saved", "Saved to Teak", "Added to your library.");
        return;
    }

    if (saveResult.status === "duplicate") {
        setState("duplicate", "Already saved", "This page is in your library.");
        return;
    }

    if (saveResult.status === "unauthenticated") {
        setState("signed-out", "Sign in to Teak", saveResult.message || "Sign in to save pages.");
        return;
    }

    setState("error", "Save failed", saveResult.message || "Teak could not save this page.");
};

const startSignIn = async () => {
    setState("checking", "Opening Teak", "Complete sign in.");
    const response = await sendNative({ type: "startSignIn" });

    if (response.authUrl) {
        await browser.tabs.create({ url: response.authUrl });
        setState("checking", "Finish sign in", "Return here after signing in.");
        return;
    }

    setState("error", "Sign in failed", response.message || "Teak could not start sign in.");
};

const signOut = async () => {
    setState("checking", "Signing out", "Clearing session...");
    await sendNative({ type: "signOut" });
    setState("signed-out", "Signed out", "Sign in to save pages.");
};

const run = async () => {
    try {
        await saveCurrentPage();
    } catch (error) {
        setState(
            "error",
            "Teak needs Safari access",
            error instanceof Error ? error.message : "Try again from a regular website."
        );
    }
};

signInButton.addEventListener("click", () => {
    startSignIn().catch((error) => {
        setState("error", "Sign in failed", error instanceof Error ? error.message : "Try again.");
    });
});

retryButton.addEventListener("click", () => {
    run();
});

signOutButton.addEventListener("click", () => {
    signOut().catch((error) => {
        setState("error", "Sign out failed", error instanceof Error ? error.message : "Try again.");
    });
});

run();
