#!/usr/bin/env bun
/**
 * Applies the WAF custom rules in `apps/core-worker/waf/rules.ts` to the
 * teakvault.com zone through the Cloudflare Rulesets API.
 *
 * Only rules whose `ref` starts with WAF_RULE_REF_PREFIX are created,
 * updated or deleted; every other custom rule in the zone is left as it is.
 *
 * Needs CLOUDFLARE_API_TOKEN with Zone: Read and Zone WAF: Edit on the zone
 * (Zone WAF: Read is enough without --apply).
 *
 * Usage: bun run waf            # show what would change (no writes)
 *        bun run waf --check    # same, exit 1 when the zone has drifted
 *        bun run waf --apply    # make the changes
 */

import {
  WAF_RULE_REF_PREFIX,
  WAF_RULES,
  WAF_ZONE_NAME,
  type WafRule,
} from "../../apps/core-worker/waf/rules";

const API = "https://api.cloudflare.com/client/v4";
const PHASE = "http_request_firewall_custom";

export interface LiveRule extends Partial<WafRule> {
  id: string;
}

export interface WafPlan {
  create: WafRule[];
  remove: LiveRule[];
  unchanged: WafRule[];
  update: { id: string; rule: WafRule }[];
}

const sameRule = (live: LiveRule, rule: WafRule): boolean =>
  live.action === rule.action &&
  live.description === rule.description &&
  live.enabled === rule.enabled &&
  live.expression === rule.expression;

export const planWafChanges = (
  live: readonly LiveRule[],
  desired: readonly WafRule[]
): WafPlan => {
  const managed = live.filter((rule) =>
    rule.ref?.startsWith(WAF_RULE_REF_PREFIX)
  );
  const plan: WafPlan = { create: [], remove: [], unchanged: [], update: [] };
  for (const rule of desired) {
    const current = managed.find((candidate) => candidate.ref === rule.ref);
    if (!current) {
      plan.create.push(rule);
    } else if (sameRule(current, rule)) {
      plan.unchanged.push(rule);
    } else {
      plan.update.push({ id: current.id, rule });
    }
  }
  plan.remove = managed.filter(
    (rule) => !desired.some((wanted) => wanted.ref === rule.ref)
  );
  return plan;
};

export const hasChanges = (plan: WafPlan): boolean =>
  plan.create.length + plan.update.length + plan.remove.length > 0;

interface CloudflareResponse<T> {
  errors?: { message: string }[];
  result: T;
  success: boolean;
}

export const cloudflareClient = (token: string, fetcher: typeof fetch) => {
  const call = async <T>(
    method: string,
    path: string,
    body?: unknown,
    options: { allowMissing?: boolean } = {}
  ): Promise<{ status: number; result: T | null }> => {
    const response = await fetcher(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 404 && options.allowMissing) {
      return { status: 404, result: null };
    }
    const payload = (await response.json()) as CloudflareResponse<T>;
    if (!payload.success) {
      const reason = payload.errors?.map((error) => error.message).join("; ");
      throw new Error(`${method} ${path} failed: ${reason ?? response.status}`);
    }
    return { status: response.status, result: payload.result };
  };
  return { call };
};

const ruleBody = ({
  action,
  description,
  enabled,
  expression,
  ref,
}: WafRule) => ({
  action,
  description,
  enabled,
  expression,
  ref,
});

export const syncWafRules = async (options: {
  apply: boolean;
  desired?: readonly WafRule[];
  fetcher?: typeof fetch;
  log?: (line: string) => void;
  token: string;
}): Promise<WafPlan> => {
  const desired = options.desired ?? WAF_RULES;
  const log = options.log ?? console.log;
  const { call } = cloudflareClient(options.token, options.fetcher ?? fetch);

  const zones = await call<{ id: string }[]>(
    "GET",
    `/zones?name=${encodeURIComponent(WAF_ZONE_NAME)}`
  );
  const zoneId = zones.result?.[0]?.id;
  if (!zoneId) {
    throw new Error(`Zone ${WAF_ZONE_NAME} is not visible to this token`);
  }
  const entrypointPath = `/zones/${zoneId}/rulesets/phases/${PHASE}/entrypoint`;
  // Cloudflare answers 404 for a phase entrypoint that has no rules yet.
  const entrypoint = await call<{ id: string; rules?: LiveRule[] }>(
    "GET",
    entrypointPath,
    undefined,
    { allowMissing: true }
  );
  const plan = planWafChanges(entrypoint.result?.rules ?? [], desired);

  for (const rule of plan.create) {
    log(`create  ${rule.ref}`);
  }
  for (const { rule } of plan.update) {
    log(`update  ${rule.ref}`);
  }
  for (const rule of plan.remove) {
    log(`delete  ${rule.ref}`);
  }
  for (const rule of plan.unchanged) {
    log(`same    ${rule.ref}`);
  }
  if (!(options.apply && hasChanges(plan))) {
    return plan;
  }

  const rulesetId = entrypoint.result?.id;
  if (!rulesetId) {
    await call("PUT", entrypointPath, { rules: plan.create.map(ruleBody) });
    return plan;
  }
  const rulesPath = `/zones/${zoneId}/rulesets/${rulesetId}/rules`;
  for (const rule of plan.create) {
    await call("POST", rulesPath, ruleBody(rule));
  }
  for (const { id, rule } of plan.update) {
    await call("PATCH", `${rulesPath}/${id}`, ruleBody(rule));
  }
  for (const rule of plan.remove) {
    await call("DELETE", `${rulesPath}/${rule.id}`);
  }
  return plan;
};

if (import.meta.main) {
  const args = new Set(process.argv.slice(2));
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    console.error(
      "CLOUDFLARE_API_TOKEN is not set (Zone: Read and Zone WAF: Edit on teakvault.com)."
    );
    process.exit(2);
  }
  const apply = args.has("--apply");
  const plan = await syncWafRules({ apply, token });
  if (!apply && hasChanges(plan)) {
    console.log("Dry run: re-run with --apply to make these changes.");
    if (args.has("--check")) {
      process.exit(1);
    }
  }
}
