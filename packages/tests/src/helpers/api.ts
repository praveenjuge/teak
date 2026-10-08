import Ajv from "ajv";
import addFormats from "ajv-formats";
import { env } from "./env";

export const apiFetch = (
  path: string,
  apiKey: string,
  init: RequestInit = {}
) =>
  fetch(`${env.apiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

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
      const rootSchema = { ...schema, components: spec.components };
      const ok = ajv.compile(rootSchema)(payload);
      if (!ok) {
        throw new Error(`OpenAPI mismatch ${method} ${path} ${status}`);
      }
    },
  };
};
