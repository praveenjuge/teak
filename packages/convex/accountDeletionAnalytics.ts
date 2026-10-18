import { env } from "./_generated/server";
import { POSTHOG_DELETION_ERROR_PREFIX } from "./accountDeletionStages";
import { POSTHOG_PROJECT_ID, POSTHOG_UI_HOST } from "./shared/posthog";

const POSTHOG_DELETION_TIMEOUT_MS = 30_000;

// bulk_delete reports a failed step per person it could not delete. These two
// steps fail only after the person is gone, so a retry would find nothing.
const STEPS_AFTER_PERSON_DELETED = new Set([
  "log_activity",
  "publish_clickhouse_tombstone",
]);

const fail = (code: string): never => {
  throw new Error(`${POSTHOG_DELETION_ERROR_PREFIX}${code}`);
};

// Once the person is gone, PostHog matches nothing and answers 202 again, and
// it never queues a second deletion for the same person.
export const deletePostHogPerson = async (
  distinctId: string
): Promise<"deleted" | "skipped"> => {
  if (!env.POSTHOG_PROJECT_TOKEN?.trim()) {
    return "skipped";
  }
  const apiKey = env.POSTHOG_PERSON_DELETION_API_KEY?.trim();
  if (!apiKey) {
    fail("unconfigured");
  }
  let response: Response;
  try {
    response = await fetch(
      `${POSTHOG_UI_HOST}/api/projects/${POSTHOG_PROJECT_ID}/persons/bulk_delete/`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          distinct_ids: [distinctId],
          delete_events: true,
          delete_recordings: true,
        }),
        signal: AbortSignal.timeout(POSTHOG_DELETION_TIMEOUT_MS),
      }
    );
  } catch {
    return fail("unreachable");
  }
  if (!response.ok) {
    fail(`status_${response.status}`);
  }
  const body = (await response.json().catch(() => null)) as {
    deletion_errors?: { step?: unknown }[];
  } | null;
  if (!body) {
    fail("invalid_response");
  }
  if (
    body?.deletion_errors?.some(
      (error) =>
        !(
          typeof error.step === "string" &&
          STEPS_AFTER_PERSON_DELETED.has(error.step)
        )
    )
  ) {
    fail("incomplete");
  }
  return "deleted";
};
