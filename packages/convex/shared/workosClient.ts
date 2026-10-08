import { WorkOS } from "@workos-inc/node";
import { isWorkosProductionApi, workosApiBase } from "./workosApi";

// The one way backend code builds a WorkOS client. Callers retry at the
// workflow or request level, so the SDK never retries on its own.
export const createWorkosClient = (apiKey: string, clientId?: string) => {
  const base = workosApiBase();
  return new WorkOS(apiKey, {
    ...(clientId === undefined ? {} : { clientId }),
    maxRetries: 0,
    timeout: 10_000,
    ...(isWorkosProductionApi(base)
      ? {}
      : {
          apiHostname: base.hostname,
          https: base.protocol === "https:",
          ...(base.port ? { port: Number(base.port) } : {}),
        }),
  });
};
