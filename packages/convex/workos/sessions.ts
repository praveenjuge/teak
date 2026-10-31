import { readResponseTextWithinLimit } from "../shared/boundedResponse";
import { workosRequest, workosUserPath } from "../shared/workosClient";
import { WORKOS_SESSION_ID } from "../shared/workosIds";

export interface WorkosSession {
  createdAt: number;
  expiresAt: number;
  id: string;
  status: "active" | "expired" | "revoked";
  userAgent: string | null;
}

const STATUSES = new Set(["active", "expired", "revoked"]);

const invalidSession = () =>
  new Error("Device service returned an invalid session.");

const parseSession = (value: unknown, workosUserId: string): WorkosSession => {
  const session = value as {
    created_at?: unknown;
    expires_at?: unknown;
    id?: unknown;
    status?: unknown;
    user_agent?: unknown;
    user_id?: unknown;
  } | null;
  const createdAt =
    typeof session?.created_at === "string"
      ? Date.parse(session.created_at)
      : Number.NaN;
  const expiresAt =
    typeof session?.expires_at === "string"
      ? Date.parse(session.expires_at)
      : Number.NaN;
  if (
    session?.user_id !== workosUserId ||
    typeof session.id !== "string" ||
    !WORKOS_SESSION_ID.test(session.id) ||
    typeof session.status !== "string" ||
    !STATUSES.has(session.status) ||
    !Number.isFinite(createdAt) ||
    !Number.isFinite(expiresAt)
  ) {
    throw invalidSession();
  }
  return {
    id: session.id,
    status: session.status as WorkosSession["status"],
    userAgent:
      typeof session.user_agent === "string" ? session.user_agent : null,
    createdAt,
    expiresAt,
  };
};

// One page of the user's AuthKit sessions, newest first.
export async function listWorkosSessions(
  workosUserId: string,
  apiKey: string,
  options: { after?: string; limit: number }
): Promise<{ after: string | null; sessions: WorkosSession[] }> {
  const response = await workosRequest(
    workosUserPath(workosUserId, "/sessions"),
    apiKey,
    {
      query: {
        limit: String(options.limit),
        after: options.after,
        order: "desc",
      },
    }
  );
  if (!response.ok) {
    throw new Error(`workos_sessions_${response.status}`);
  }
  const body = await readResponseTextWithinLimit(response, 256 * 1024);
  if (body === null) {
    throw invalidSession();
  }
  const payload = JSON.parse(body) as {
    data?: unknown;
    list_metadata?: { after?: unknown };
  };
  if (!Array.isArray(payload.data) || payload.data.length > options.limit) {
    throw invalidSession();
  }
  const after = payload.list_metadata?.after;
  if (after !== undefined && after !== null && typeof after !== "string") {
    throw invalidSession();
  }
  return {
    sessions: payload.data.map((session) =>
      parseSession(session, workosUserId)
    ),
    after: after || null,
  };
}

// A session WorkOS no longer has is already signed out.
export async function revokeWorkosSession(sessionId: string, apiKey: string) {
  const response = await workosRequest(
    "/user_management/sessions/revoke",
    apiKey,
    {
      method: "POST",
      body: { session_id: sessionId },
    }
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`workos_session_revoke_${response.status}`);
  }
}
