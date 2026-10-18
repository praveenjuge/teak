import { createHash, randomBytes } from "node:crypto";
import { type AuthDiscovery, validateOAuthUrl } from "@teak/convex/sdk";
import { readResponseTextWithinLimit } from "@teak/convex/shared/boundedResponse";
import { workosResourcesFor } from "@teak/convex/shared/workosResources";
import { apiFetch } from "./api";
import { openSecurity } from "./app";
import { connectMcp } from "./mcp";
import { expect, type Surface } from "./test";

interface Grant {
  accessToken: string;
  clientId: string;
  consentId: string;
  refreshToken: string;
  resource: string;
}

async function readJson(url: string, init?: RequestInit) {
  const response = await fetch(validateOAuthUrl(url).href, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  expect(response.ok, `OAuth response status ${response.status}`).toBe(true);
  const text = await readResponseTextWithinLimit(response, 64 * 1024);
  expect(text, "OAuth response exceeded the size limit").not.toBeNull();
  if (text === null) {
    throw new Error("OAuth response exceeded the size limit");
  }
  const payload: unknown = JSON.parse(text);
  expect(payload).toBeTruthy();
  expect(typeof payload).toBe("object");
  expect(Array.isArray(payload)).toBe(false);
  return payload as Record<string, unknown>;
}

function claims(
  accessToken: string,
  provider: AuthDiscovery,
  resource: string
) {
  const payload = JSON.parse(
    Buffer.from(accessToken.split(".")[1], "base64url").toString()
  ) as Record<string, unknown>;
  expect(payload.iss).toBe(provider.issuer);
  expect(payload.aud).toBe(resource);
  expect(payload.sub).toMatch(/^user_[A-Za-z0-9]+$/);
  expect(payload.sid).toMatch(/^app_consent_[A-Za-z0-9]+$/);
  return payload.sid as string;
}

function token(provider: AuthDiscovery, form: Record<string, string>) {
  return readJson(provider.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
}

async function refresh(provider: AuthDiscovery, grant: Grant): Promise<Grant> {
  const result = await token(provider, {
    client_id: grant.clientId,
    grant_type: "refresh_token",
    refresh_token: grant.refreshToken,
    resource: grant.resource,
  });
  expect(typeof result.access_token).toBe("string");
  expect(typeof result.refresh_token).toBe("string");
  const consentId = claims(
    result.access_token as string,
    provider,
    grant.resource
  );
  expect(consentId).toBe(grant.consentId);
  return {
    ...grant,
    accessToken: result.access_token as string,
    refreshToken: result.refresh_token as string,
  };
}

/**
 * The message a promise rejects with; fails when it resolves. e2e's `expect`
 * has no `rejects.toThrow`, so callers match this message instead.
 */
export async function rejectionOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Expected the promise to reject, but it resolved");
}

async function authorize(
  { browser, screen }: Surface,
  provider: AuthDiscovery,
  registrationEndpoint: string,
  resource: string
): Promise<Grant> {
  const marker = randomBytes(8).toString("hex");
  const clientName = `Teak security test ${marker}`;
  const redirectUri = `https://oauth-e2e.invalid/callback/${marker}`;
  const registration = await readJson(registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: clientName,
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: [redirectUri],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  expect(typeof registration.client_id).toBe("string");
  const clientId = registration.client_id as string;
  const verifier = randomBytes(48).toString("base64url");
  const state = randomBytes(24).toString("base64url");
  const authorizeUrl = new URL(provider.authorizationEndpoint);
  authorizeUrl.search = new URLSearchParams({
    client_id: clientId,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    redirect_uri: redirectUri,
    resource,
    response_type: "code",
    scope: "openid profile email offline_access",
    state,
  }).toString();
  let callback: URL | undefined;
  const callbackRoute = `${redirectUri}*`;
  await browser.route(callbackRoute, async (route) => {
    callback = new URL(route.request.url);
    await route.fulfill({ body: "OAuth callback received", status: 200 });
  });
  try {
    await browser.goto(authorizeUrl.href);
    await expect(
      screen.getByText(`${clientName} would like access to your account`, {
        exact: false,
      })
    ).toBeVisible();
    await expect(
      screen.getByText("Confirmation of your identity")
    ).toBeVisible();
    await expect(screen.getByText("Your email address")).toBeVisible();
    await screen.getByRole("button", "Allow access").click();
    await expect.poll(() => callback?.searchParams.get("state")).toBe(state);
    const code = callback?.searchParams.get("code");
    expect(code).toBeTruthy();
    if (!code) {
      throw new Error("OAuth callback had no authorization code");
    }
    const result = await token(provider, {
      client_id: clientId,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      resource,
    });
    expect(typeof result.access_token).toBe("string");
    expect(typeof result.refresh_token).toBe("string");
    return {
      accessToken: result.access_token as string,
      clientId,
      consentId: claims(result.access_token as string, provider, resource),
      refreshToken: result.refresh_token as string,
      resource,
    };
  } finally {
    await browser.unroute(callbackRoute);
  }
}

export async function verifyWorkosConsentJourney(
  surface: Surface,
  provider: AuthDiscovery,
  expectedApiKey: string
) {
  expect(provider.primary).toBe("workos");
  const metadataUrl = new URL(provider.issuer);
  metadataUrl.pathname = `/.well-known/oauth-authorization-server${metadataUrl.pathname.replace(/\/$/, "")}`;
  const metadata = await readJson(metadataUrl.href);
  expect(metadata.issuer).toBe(provider.issuer);
  expect(metadata.authorization_endpoint).toBe(provider.authorizationEndpoint);
  expect(metadata.token_endpoint).toBe(provider.tokenEndpoint);
  const registrationEndpoint = validateOAuthUrl(
    metadata.registration_endpoint
  ).href;
  expect(new URL(registrationEndpoint).origin).toBe(
    new URL(provider.issuer).origin
  );

  const resources = workosResourcesFor(provider.resource);
  const apiGrant = await authorize(
    surface,
    provider,
    registrationEndpoint,
    resources.api
  );
  const mcpGrant = await authorize(
    surface,
    provider,
    registrationEndpoint,
    resources.mcp
  );
  expect(apiGrant.consentId).not.toBe(mcpGrant.consentId);
  expect((await apiFetch("/v1/tags", apiGrant.accessToken)).status).toBe(200);
  expect(await rejectionOf(connectMcp(apiGrant.accessToken))).toMatch(
    /401|unauthorized/i
  );
  expect((await apiFetch("/v1/tags", mcpGrant.accessToken)).status).toBe(401);
  const mcp = await connectMcp(mcpGrant.accessToken);
  let ownedCardId: string | undefined;
  try {
    const marker = `consent-owner-${randomBytes(24).toString("hex")}`;
    const created = await apiFetch("/v1/cards", expectedApiKey, {
      method: "POST",
      body: JSON.stringify({ content: marker }),
    });
    expect(created.status).toBe(200);
    const owned = await created.json();
    expect(typeof owned.cardId).toBe("string");
    ownedCardId = owned.cardId;
    const restCard = await apiFetch(
      `/v1/cards/${ownedCardId}`,
      apiGrant.accessToken
    );
    expect(restCard.status).toBe(200);
    expect(await restCard.json()).toMatchObject({ content: marker });
    const mcpCard = await mcp.callTool({
      name: "teak_v1_get_card",
      arguments: { cardId: ownedCardId },
    });
    expect(mcpCard.isError).not.toBe(true);
    expect(mcpCard.structuredContent).toMatchObject({ content: marker });
    expect((await mcp.listTools()).tools.length).toBeGreaterThan(0);
    const dialog = await openSecurity(surface);
    const apiRow = dialog.getByTestId(`connection-${apiGrant.consentId}`);
    const mcpRow = dialog.getByTestId(`connection-${mcpGrant.consentId}`);
    await expect(apiRow).toBeVisible();
    await expect(mcpRow).toBeVisible();
    await apiRow.getByRole("button", "Disconnect", { exact: false }).click();
    await expect(apiRow).toHaveCount(0);
    expect((await apiFetch("/v1/tags", apiGrant.accessToken)).status).toBe(401);
    const deniedRefresh = await refresh(provider, apiGrant);
    expect((await apiFetch("/v1/tags", deniedRefresh.accessToken)).status).toBe(
      401
    );
    await expect(mcpRow).toBeVisible();
    expect((await mcp.listTools()).tools.length).toBeGreaterThan(0);
    await mcpRow.getByRole("button", "Disconnect", { exact: false }).click();
    await expect(mcpRow).toHaveCount(0);
    expect(await rejectionOf(mcp.listTools())).toMatch(/401|unauthorized/i);
    const deniedMcpRefresh = await refresh(provider, mcpGrant);
    expect(await rejectionOf(connectMcp(deniedMcpRefresh.accessToken))).toMatch(
      /401|unauthorized/i
    );
  } finally {
    try {
      if (ownedCardId) {
        expect(
          (
            await apiFetch(`/v1/cards/${ownedCardId}`, expectedApiKey, {
              method: "DELETE",
            })
          ).status
        ).toBe(200);
      }
    } finally {
      await mcp.close();
    }
  }
}
