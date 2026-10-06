import { afterEach, beforeEach, expect, test, vi } from "vitest";

const deployments = [
  {
    cloud: "https://reminiscent-kangaroo-59.convex.cloud",
    site: "https://reminiscent-kangaroo-59.convex.site",
    client: "client_01KBYSVNVDV2G39REZFGF0K7GD",
    otherClient: "client_01M46HC8K0DD50SC59QX9DV3MX",
  },
  {
    cloud: "https://uncommon-ladybug-882.convex.cloud",
    site: "https://uncommon-ladybug-882.convex.site",
    client: "client_01M46HC8K0DD50SC59QX9DV3MX",
    otherClient: "client_01KBYSVNVDV2G39REZFGF0K7GD",
  },
];
// Failure modes: accepting another environment's issuer, trusting arbitrary
// deployments/clients, dropping Better Auth, or changing mode during setup.
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("JWKS", "null");
  vi.stubEnv("AUTH_PRIMARY", "betterauth");
  vi.stubEnv("SIGNUPS_DISABLED", "true");
});
afterEach(() => vi.unstubAllEnvs());

test.each(deployments)(
  "preserves Better Auth and trusts only the provisioned client for $cloud",
  async ({ cloud, site, client }) => {
    vi.stubEnv("CONVEX_CLOUD_URL", cloud);
    vi.stubEnv("CONVEX_SITE_URL", site);
    vi.stubEnv("WORKOS_CLIENT_ID", client);
    const { default: config } = await import("./auth.config");
    expect(config.providers).toEqual([
      {
        type: "customJwt",
        issuer: site,
        applicationID: "convex",
        algorithm: "RS256",
        jwks: `${site}/api/auth/convex/jwks`,
      },
      {
        type: "customJwt",
        issuer: `https://api.workos.com/user_management/${client}`,
        algorithm: "RS256",
        jwks: `https://api.workos.com/sso/jwks/${client}`,
      },
    ]);
    expect(process.env.AUTH_PRIMARY).toBe("betterauth");
    expect(process.env.SIGNUPS_DISABLED).toBe("true");
  }
);
for (const deployment of deployments) {
  test.each(["missing", "cross-environment", "arbitrary"])(
    `refuses %s client binding for ${deployment.cloud}`,
    async (failure) => {
      vi.stubEnv("CONVEX_CLOUD_URL", deployment.cloud);
      vi.stubEnv("CONVEX_SITE_URL", deployment.site);
      let client: string | undefined;
      if (failure === "cross-environment") {
        client = deployment.otherClient;
      } else if (failure === "arbitrary") {
        client = "client_unapproved";
      }
      vi.stubEnv("WORKOS_CLIENT_ID", client);
      await expect(import("./auth.config")).rejects.toThrow(
        "WorkOS AuthKit client does not match the provisioned deployment"
      );
    }
  );
}
test.each([
  "http://127.0.0.1:3210",
  "https://other.convex.cloud",
  "https://uncommon-ladybug-882.convex.cloud/",
  "https://uncommon-ladybug-882.convex.cloud.attacker.test",
])("keeps only Better Auth for unapproved deployment %s", async (cloud) => {
  vi.stubEnv("CONVEX_CLOUD_URL", cloud);
  vi.stubEnv("CONVEX_SITE_URL", "http://127.0.0.1:3211");
  vi.stubEnv("WORKOS_CLIENT_ID", deployments[1].client);
  const { default: config } = await import("./auth.config");
  expect(config.providers).toHaveLength(1);
  expect(config.providers[0]).toMatchObject({
    issuer: "http://127.0.0.1:3211",
    applicationID: "convex",
  });
});
