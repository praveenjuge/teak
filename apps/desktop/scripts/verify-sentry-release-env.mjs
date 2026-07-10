const required = [
  "SENTRY_AUTH_TOKEN",
  "VITE_GIT_COMMIT_SHA",
  "VITE_PUBLIC_SENTRY_DESKTOP_DSN",
];
const missing = required.filter((name) => !process.env[name]?.trim());

if (missing.length > 0) {
  throw new Error(
    `Desktop release telemetry requires ${missing.join(", ")} before signed artifacts are built.`
  );
}
