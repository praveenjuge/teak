import { appendFileSync } from "node:fs";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { env } from "./env";

interface Perf {
  endpoint: string;
  ms: number;
  status: number;
}
const perf: Perf[] = [];

export const apiFetch = async (
  path: string,
  apiKey: string,
  init: RequestInit = {}
) => {
  const start = performance.now();
  const response = await fetch(`${env.apiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  perf.push({
    endpoint: path,
    ms: Math.round(performance.now() - start),
    status: response.status,
  });
  return response;
};

export const loadOpenApi = async () => {
  const response = await fetch(`${env.apiUrl}/openapi.json`);
  if (!response.ok) {
    throw new Error(`OpenAPI failed: ${response.status}`);
  }
  const spec = (await response.json()) as any;
  const ajv = new Ajv({ strict: false });
  addFormats(ajv as any);
  return {
    spec,
    validate(path: string, method: string, status: number, payload: unknown) {
      const schema =
        spec.paths?.[path]?.[method.toLowerCase()]?.responses?.[status]
          ?.content?.["application/json"]?.schema;
      if (!schema) {
        return;
      }
      const ok = ajv.compile(schema)(payload);
      if (!ok) {
        throw new Error(`OpenAPI mismatch ${method} ${path} ${status}`);
      }
    },
  };
};

export const perfSummary = () => {
  const rows = perf.map((p) => `| ${p.endpoint} | ${p.status} | ${p.ms}ms |`);
  const table = [
    "| Endpoint | Status | Latency |",
    "| --- | ---: | ---: |",
    ...rows,
  ].join("\n");
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `\n### Production API latency\n\n${table}\n`
    );
  }
  const slow = perf.filter(
    (p) => p.ms > Number(process.env.PROD_E2E_API_BUDGET_MS ?? 5000)
  );
  if (slow.length) {
    throw new Error(
      `API latency budget exceeded: ${slow.map((p) => p.endpoint).join(", ")}`
    );
  }
};
