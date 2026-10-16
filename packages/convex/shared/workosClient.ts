import { WorkOS } from "@workos-inc/node";
import { isWorkosProductionApi, workosApiBase } from "./workosApi";

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
