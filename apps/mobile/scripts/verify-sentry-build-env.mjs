const REQUIRED_PRODUCTION_ENV = [
  "EXPO_PUBLIC_SENTRY_MOBILE_DSN",
  "SENTRY_AUTH_TOKEN",
];

if (process.env.EAS_BUILD_PROFILE === "production") {
  const missing = REQUIRED_PRODUCTION_ENV.filter(
    (name) => !process.env[name]?.trim()
  );
  if (missing.length > 0) {
    throw new Error(
      `Production mobile builds require ${missing.join(", ")} so source maps and symbols cannot be silently skipped.`
    );
  }
}
