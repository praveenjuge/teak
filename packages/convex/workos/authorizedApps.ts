import { readResponseTextWithinLimit } from "../shared/boundedResponse";
import { workosRequest, workosUserPath } from "../shared/workosClient";

const APP_ID = /^(?:connect_app_|conn_app_)[A-Za-z0-9]+$/;

export interface AuthorizedApp {
  clientId: string | null;
  id: string;
}

const appsPath = (workosUserId: string, appId?: string) =>
  workosUserPath(
    workosUserId,
    `/authorized_applications${appId ? `/${encodeURIComponent(appId)}` : ""}`
  );

export async function listAuthorizedAppsPage(
  workosUserId: string,
  apiKey: string,
  options: { after?: string; limit: number; timeoutMs: number }
): Promise<{ apps: AuthorizedApp[]; after: string | null } | null> {
  const response = await workosRequest(appsPath(workosUserId), apiKey, {
    query: { limit: String(options.limit), after: options.after || undefined },
    timeoutMs: options.timeoutMs,
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`workos_authorized_apps_${response.status}`);
  }
  const body = await readResponseTextWithinLimit(response, 256 * 1024);
  if (body === null) {
    throw new Error("workos_authorized_apps_oversized");
  }
  const payload = JSON.parse(body) as {
    data?: { application?: { id?: unknown; client_id?: unknown } }[];
    list_metadata?: { after?: unknown };
  };
  if (!Array.isArray(payload.data) || payload.data.length > options.limit) {
    throw new Error("workos_authorized_apps_invalid");
  }
  const apps = payload.data.map((entry) => {
    const app = entry.application;
    // WorkOS returns connect_app_; its API reference also documents conn_app_.
    if (!(typeof app?.id === "string" && APP_ID.test(app.id))) {
      throw new Error("workos_authorized_apps_invalid");
    }
    return {
      id: app.id,
      clientId: typeof app.client_id === "string" ? app.client_id : null,
    };
  });
  const next = payload.list_metadata?.after;
  if (next === undefined || next === null || next === "") {
    return { apps, after: null };
  }
  if (
    typeof next !== "string" ||
    next.length > 256 ||
    /[\s\p{Cc}]/u.test(next) ||
    next === options.after
  ) {
    throw new Error("workos_authorized_apps_cursor_invalid");
  }
  return { apps, after: next };
}

export async function deleteAuthorizedApp(
  workosUserId: string,
  appId: string,
  apiKey: string,
  timeoutMs: number
): Promise<void> {
  if (!APP_ID.test(appId)) {
    throw new Error("workos_authorized_apps_invalid");
  }
  const response = await workosRequest(appsPath(workosUserId, appId), apiKey, {
    method: "DELETE",
    timeoutMs,
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`workos_authorized_apps_${response.status}`);
  }
}
