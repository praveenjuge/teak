import path from "node:path";
import { getSentryExpoConfig } from "@sentry/react-native/metro.js";

const projectRoot = import.meta.dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getSentryExpoConfig(projectRoot, {
  annotateReactComponents: true,
  autoWrapExpoRouterErrorBoundary: true,
});

// Watch all files in the monorepo
config.watchFolders = [...(config.watchFolders ?? []), workspaceRoot];
// Try resolving with project modules first, then workspace modules
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

config.transformer = {
  ...config.transformer,
  getTransformOptions: async () => ({
    transform: {
      inlineRequires: true,
    },
  }),
};

export default config;
