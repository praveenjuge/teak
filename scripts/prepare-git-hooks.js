const { execSync } = require("node:child_process");

const shouldSkip =
  process.env.CI ||
  process.env.SKIP_SIMPLE_GIT_HOOKS === "1" ||
  process.env.SKIP_SIMPLE_GIT_HOOKS === "true";

if (shouldSkip) {
  process.exit(0);
}

try {
  require.resolve("simple-git-hooks");
} catch {
  process.exit(0);
}

try {
  execSync("simple-git-hooks", { stdio: "inherit" });
} catch (error) {
  // Avoid breaking installs when hooks cannot be set up in constrained environments.
  process.exit(process.env.CI ? 0 : 1);
}
