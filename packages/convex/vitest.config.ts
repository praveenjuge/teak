import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: [
      "./occContention.test.ts",
      "./accountDeletionRetry.test.ts",
      "./importConsolidation.test.ts",
      "./safariOAuth.test.ts",
      "./securitySessions.test.ts",
      "./identityTable.test.ts",
      "./workosUsers.test.ts",
      "./workosLifecycle.test.ts",
      "./workosIdentity.test.ts",
      "./identityBearer.test.ts",
      "./signupFreeze.test.ts",
      "./workosReadiness.test.ts",
      "./publicApiCardEditing.test.ts",
      "./publicApiMe.test.ts",
      "./mcpRevocation.test.ts",
      "./maintenanceQueries.test.ts",
      "./idempotency.test.ts",
      "./operationalRetention.test.ts",
      "./costOptimization.test.ts",
      "./rawMetadata.test.ts",
      "./rawMetadataPipeline.test.ts",
    ],
  },
});
