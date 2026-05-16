const statusLabel = document.getElementById("account-status");
const signInButton = document.getElementById("sign-in");
const signOutButton = document.getElementById("sign-out");
const preferencesButton = document.getElementById("open-preferences");

function show(platform, enabled, useSettingsInsteadOfPreferences) {
    document.body.classList.add(`platform-${platform}`);

    if (useSettingsInsteadOfPreferences) {
        preferencesButton.innerText = "Open Safari Settings";
    }

    if (typeof enabled === "boolean") {
        document.body.classList.toggle("state-on", enabled);
        document.body.classList.toggle("state-off", !enabled);
    } else {
        document.body.classList.remove("state-on");
        document.body.classList.remove("state-off");
    }
}

function renderAccountState(state) {
    const authenticated = state.authenticated === true;
    document.body.classList.toggle("signed-in", authenticated);

    if (authenticated) {
        statusLabel.innerText = "Ready.";
        return;
    }

    statusLabel.innerText = state.message || "Sign in to save.";
}

function post(command) {
    webkit.messageHandlers.controller.postMessage(command);
}

signInButton.addEventListener("click", () => post("start-sign-in"));
signOutButton.addEventListener("click", () => post("sign-out"));
preferencesButton.addEventListener("click", () => post("open-preferences"));

post("refresh");
