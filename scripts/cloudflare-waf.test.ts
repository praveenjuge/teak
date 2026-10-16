import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { unstable_readConfig } from "wrangler";
import {
  API_PROXY_MAX_BODY_BYTES,
  upstreamPathFor,
} from "../apps/files-worker/src/apiProxy";
import {
  API_REQUESTS,
  declaredLengthOver,
  WAF_RULE_REF_PREFIX,
  WAF_RULES,
  WAF_ZONE_NAME,
  type WafRule,
} from "../apps/files-worker/waf/rules";
import { type LiveRule, planWafChanges, syncWafRules } from "./cloudflare-waf";

const rule = (name: string, expression = "true"): WafRule => ({
  action: "block",
  description: `rule ${name}`,
  enabled: true,
  expression,
  ref: `${WAF_RULE_REF_PREFIX}${name}`,
});

const live = (id: string, wafRule: WafRule): LiveRule => ({ id, ...wafRule });

describe("planning", () => {
  test("creates missing rules, updates changed ones and deletes retired ones", () => {
    const plan = planWafChanges(
      [
        live("r1", rule("same")),
        live("r2", rule("changed", "false")),
        live("r3", rule("retired")),
      ],
      [rule("same"), rule("changed"), rule("new")]
    );
    expect(plan.create.map((r) => r.ref)).toEqual([
      `${WAF_RULE_REF_PREFIX}new`,
    ]);
    expect(plan.update).toEqual([{ id: "r2", rule: rule("changed") }]);
    expect(plan.remove.map((r) => r.id)).toEqual(["r3"]);
    expect(plan.unchanged.map((r) => r.ref)).toEqual([
      `${WAF_RULE_REF_PREFIX}same`,
    ]);
  });

  test("never plans changes to rules it does not own", () => {
    const plan = planWafChanges(
      [
        { id: "mine", ...rule("old") },
        { id: "dashboard", ref: "my-own-rule", expression: "true" },
        { id: "unnamed", expression: "true" },
      ],
      []
    );
    expect(plan.remove.map((r) => r.id)).toEqual(["mine"]);
  });
});

const cloudflare = (
  entrypoint: { id: string; rules: LiveRule[] } | null,
  options: { missingWrites?: boolean } = {}
) => {
  const calls: { body: unknown; method: string; path: string }[] = [];
  const fetcher = ((url: string, init: RequestInit = {}) => {
    const path = String(url).replace(
      "https://api.cloudflare.com/client/v4",
      ""
    );
    const method = init.method ?? "GET";
    calls.push({
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      method,
      path,
    });
    if (path.startsWith("/zones?name=")) {
      return Promise.resolve(
        Response.json({ success: true, result: [{ id: "zone1" }] })
      );
    }
    if (method === "GET" && path.endsWith("/entrypoint") && !entrypoint) {
      return Promise.resolve(new Response("{}", { status: 404 }));
    }
    if (method !== "GET" && options.missingWrites) {
      return Promise.resolve(
        Response.json(
          { success: false, errors: [{ message: "not found" }] },
          { status: 404 }
        )
      );
    }
    return Promise.resolve(
      Response.json({ success: true, result: entrypoint ?? {} })
    );
  }) as typeof fetch;
  const writes = () => calls.filter((call) => call.method !== "GET");
  return { calls, fetcher, writes };
};

describe("syncing a zone", () => {
  test("a dry run reads but never writes", async () => {
    const { fetcher, writes } = cloudflare({ id: "rs1", rules: [] });
    const plan = await syncWafRules({
      apply: false,
      desired: [rule("new")],
      fetcher,
      log: () => undefined,
      token: "t",
    });
    expect(plan.create).toHaveLength(1);
    expect(writes()).toEqual([]);
  });

  test("creates the phase entrypoint with only its rules when the zone has none", async () => {
    const { fetcher, writes } = cloudflare(null);
    await syncWafRules({
      apply: true,
      desired: [rule("new")],
      fetcher,
      log: () => undefined,
      token: "t",
    });
    expect(writes()).toEqual([
      {
        method: "PUT",
        path: "/zones/zone1/rulesets/phases/http_request_firewall_custom/entrypoint",
        body: { rules: [rule("new")] },
      },
    ]);
  });

  test("edits rule by rule when the zone already has custom rules, leaving others alone", async () => {
    const { fetcher, writes } = cloudflare({
      id: "rs1",
      rules: [
        { id: "dashboard", ref: "someone-else", expression: "true" },
        live("r2", rule("changed", "false")),
        live("r3", rule("retired")),
      ],
    });
    await syncWafRules({
      apply: true,
      desired: [rule("changed"), rule("new")],
      fetcher,
      log: () => undefined,
      token: "t",
    });
    expect(writes()).toEqual([
      {
        method: "POST",
        path: "/zones/zone1/rulesets/rs1/rules",
        body: rule("new"),
      },
      {
        method: "PATCH",
        path: "/zones/zone1/rulesets/rs1/rules/r2",
        body: rule("changed"),
      },
      {
        method: "DELETE",
        path: "/zones/zone1/rulesets/rs1/rules/r3",
        body: undefined,
      },
    ]);
  });
});

describe("failed writes", () => {
  test("an apply whose write finds nothing fails instead of passing", async () => {
    const { fetcher } = cloudflare(
      { id: "rs1", rules: [live("r2", rule("changed", "false"))] },
      { missingWrites: true }
    );
    await expect(
      syncWafRules({
        apply: true,
        desired: [rule("changed")],
        fetcher,
        log: () => undefined,
        token: "t",
      })
    ).rejects.toThrow("PATCH");
  });
});

describe("the managed rules", () => {
  test("every rule carries the managed ref prefix", () => {
    for (const wafRule of WAF_RULES) {
      expect(wafRule.ref.startsWith(WAF_RULE_REF_PREFIX)).toBe(true);
    }
  });

  test("the rules cover exactly the API requests the Worker proxies", () => {
    expect(API_REQUESTS).toBe(
      'http.host eq "teakvault.com" and (http.request.uri.path in {"/api" "/mcp"} or starts_with(http.request.uri.path, "/api/") or starts_with(http.request.uri.path, "/mcp/"))'
    );
    expect(WAF_ZONE_NAME).toBe(
      unstable_readConfig({
        config: resolve(import.meta.dir, "../apps/files-worker/wrangler.jsonc"),
      }).vars.API_PUBLIC_HOST as string
    );
    for (const path of ["/api", "/api/v1/cards", "/mcp", "/mcp/x"]) {
      expect(upstreamPathFor(path)).not.toBeNull();
    }
    for (const path of ["/apis", "/mcpfoo"]) {
      expect(upstreamPathFor(path)).toBeNull();
    }
  });

  test("the body rule blocks at exactly the Worker's own body limit", () => {
    const [oversized] = WAF_RULES;
    expect(oversized?.expression).toContain(
      declaredLengthOver(API_PROXY_MAX_BODY_BYTES)
    );
    expect(API_PROXY_MAX_BODY_BYTES).toBe(20_000_000);
    expect(declaredLengthOver(API_PROXY_MAX_BODY_BYTES)).toBe(
      '(not starts_with(http.request.headers["content-length"][0], "0") and (len(http.request.headers["content-length"][0]) gt 8 or (len(http.request.headers["content-length"][0]) eq 8 and http.request.headers["content-length"][0] gt "20000000")))'
    );
  });
});
