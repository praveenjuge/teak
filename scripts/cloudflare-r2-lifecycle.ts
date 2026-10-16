#!/usr/bin/env bun
/**
 * Applies Teak's R2 bucket configuration through the Cloudflare API:
 *
 * - lifecycle rules: export archives expire after 8 days (Convex deletes them
 *   after 7; this is the backstop for anything it misses), and incomplete
 *   multipart uploads are aborted after a day;
 * - event notifications: every object written under `users/` or `dev/users/`
 *   goes to the bucket's R2 events queue, whose consumer deletes pending
 *   uploads nobody finalized (apps/files-worker/src/queues/r2Events.ts).
 *
 * Only lifecycle rules whose id, and notification rules whose description,
 * starts with R2_RULE_PREFIX are created, updated or deleted; every other
 * rule on the buckets is left as it is.
 *
 * Needs CLOUDFLARE_API_TOKEN with Workers R2 Storage: Edit and Queues: Read
 * on the account (Workers R2 Storage: Read is enough without --apply).
 *
 * Usage: bun run r2:lifecycle            # show what would change (no writes)
 *        bun run r2:lifecycle --check    # same, exit 1 when a bucket has drifted
 *        bun run r2:lifecycle --apply    # make the changes
 */

import { cloudflareClient } from "./cloudflare-waf";

export const R2_RULE_PREFIX = "teak-";
/** The account in both Wrangler configs. */
const DEFAULT_ACCOUNT_ID = "dd19e45b8f2f3cc0393cc2deb51fa27d";
const DAY_SECONDS = 24 * 60 * 60;

interface AgeCondition {
  maxAge: number;
  type: "Age";
}

export interface LifecycleRule {
  abortMultipartUploadsTransition?: { condition: AgeCondition };
  conditions: { prefix: string };
  deleteObjectsTransition?: { condition: AgeCondition };
  enabled: boolean;
  id: string;
  storageClassTransitions?: unknown[];
}

export interface NotificationRule {
  actions: string[];
  description: string;
  prefix: string;
  suffix: string;
}

export interface LiveNotificationRule extends Partial<NotificationRule> {
  ruleId: string;
}

export interface BucketConfig {
  lifecycle: LifecycleRule[];
  /** Notification rules by the queue they send to. */
  notifications: Record<string, NotificationRule[]>;
}

const OBJECT_CREATE = ["PutObject", "CompleteMultipartUpload", "CopyObject"];

const expire = (id: string, prefix: string, days: number): LifecycleRule => ({
  conditions: { prefix },
  deleteObjectsTransition: {
    condition: { maxAge: days * DAY_SECONDS, type: "Age" },
  },
  enabled: true,
  id,
});

const ABORT_INCOMPLETE_UPLOADS: LifecycleRule = {
  abortMultipartUploadsTransition: {
    condition: { maxAge: DAY_SECONDS, type: "Age" },
  },
  conditions: { prefix: "" },
  enabled: true,
  id: `${R2_RULE_PREFIX}abort-incomplete-uploads`,
};

const userWrites = (description: string, prefix: string): NotificationRule => ({
  actions: OBJECT_CREATE,
  description: `${R2_RULE_PREFIX}${description}`,
  prefix,
  suffix: "",
});

export const R2_BUCKETS: Record<string, BucketConfig> = {
  // Production; development shares it under `dev/` until the storage switch.
  "teak-files-prod": {
    lifecycle: [
      expire(`${R2_RULE_PREFIX}expire-exports`, "exports/", 8),
      expire(`${R2_RULE_PREFIX}expire-dev-exports`, "dev/exports/", 8),
      ABORT_INCOMPLETE_UPLOADS,
    ],
    notifications: {
      "teak-r2-events": [
        userWrites("user-writes", "users/"),
        userWrites("dev-user-writes", "dev/users/"),
      ],
    },
  },
  // The isolated development Worker's bucket (keys keep the `dev/` prefix).
  "teak-files-development-20261006": {
    lifecycle: [
      expire(`${R2_RULE_PREFIX}expire-dev-exports`, "dev/exports/", 8),
      ABORT_INCOMPLETE_UPLOADS,
    ],
    notifications: {
      "teak-dev-r2-events": [userWrites("dev-user-writes", "dev/users/")],
    },
  },
};

export interface ChangePlan<Desired, Live> {
  create: Desired[];
  remove: Live[];
  unchanged: Desired[];
  update: { live: Live; rule: Desired }[];
}

const emptyPlan = <D, L>(): ChangePlan<D, L> => ({
  create: [],
  remove: [],
  unchanged: [],
  update: [],
});

export const hasChanges = (plan: ChangePlan<unknown, unknown>): boolean =>
  plan.create.length + plan.update.length + plan.remove.length > 0;

const ageOf = (transition?: { condition?: Partial<AgeCondition> }) =>
  transition?.condition?.type === "Age" ? transition.condition.maxAge : null;

const sameLifecycleRule = (live: LifecycleRule, rule: LifecycleRule) =>
  live.enabled === rule.enabled &&
  (live.conditions?.prefix ?? "") === rule.conditions.prefix &&
  ageOf(live.deleteObjectsTransition) === ageOf(rule.deleteObjectsTransition) &&
  ageOf(live.abortMultipartUploadsTransition) ===
    ageOf(rule.abortMultipartUploadsTransition) &&
  (live.storageClassTransitions?.length ?? 0) === 0;

export const planLifecycle = (
  live: readonly LifecycleRule[],
  desired: readonly LifecycleRule[]
): ChangePlan<LifecycleRule, LifecycleRule> => {
  const owned = live.filter((rule) => rule.id.startsWith(R2_RULE_PREFIX));
  const plan = emptyPlan<LifecycleRule, LifecycleRule>();
  for (const rule of desired) {
    const current = owned.find((candidate) => candidate.id === rule.id);
    if (!current) {
      plan.create.push(rule);
    } else if (sameLifecycleRule(current, rule)) {
      plan.unchanged.push(rule);
    } else {
      plan.update.push({ live: current, rule });
    }
  }
  plan.remove = owned.filter(
    (rule) => !desired.some((wanted) => wanted.id === rule.id)
  );
  return plan;
};

/**
 * The whole rule set to PUT: rules the script does not own, as they are,
 * then the desired ones. The lifecycle API replaces every rule at once.
 */
export const lifecycleRulesToPut = (
  live: readonly LifecycleRule[],
  desired: readonly LifecycleRule[]
): LifecycleRule[] => [
  ...live.filter((rule) => !rule.id.startsWith(R2_RULE_PREFIX)),
  ...desired,
];

const sameActions = (a: readonly string[] | undefined, b: readonly string[]) =>
  a !== undefined &&
  a.length === b.length &&
  b.every((action) => a.includes(action));

export const planNotifications = (
  live: readonly LiveNotificationRule[],
  desired: readonly NotificationRule[]
): ChangePlan<NotificationRule, LiveNotificationRule> => {
  const owned = live.filter((rule) =>
    rule.description?.startsWith(R2_RULE_PREFIX)
  );
  const plan = emptyPlan<NotificationRule, LiveNotificationRule>();
  for (const rule of desired) {
    const current = owned.find(
      (candidate) => candidate.description === rule.description
    );
    if (!current) {
      plan.create.push(rule);
    } else if (
      (current.prefix ?? "") === rule.prefix &&
      (current.suffix ?? "") === rule.suffix &&
      sameActions(current.actions, rule.actions)
    ) {
      plan.unchanged.push(rule);
    } else {
      plan.update.push({ live: current, rule });
    }
  }
  plan.remove = owned.filter(
    (rule) => !desired.some((wanted) => wanted.description === rule.description)
  );
  return plan;
};

interface NotificationConfig {
  queues?: Array<{
    queueId: string;
    queueName: string;
    rules: LiveNotificationRule[];
  }>;
}

export interface BucketPlan {
  bucket: string;
  lifecycle: ChangePlan<LifecycleRule, LifecycleRule>;
  notifications: Record<
    string,
    ChangePlan<NotificationRule, LiveNotificationRule>
  >;
}

export const bucketHasChanges = (plan: BucketPlan): boolean =>
  hasChanges(plan.lifecycle) ||
  Object.values(plan.notifications).some(hasChanges);

export const syncR2Buckets = async (options: {
  accountId?: string;
  apply: boolean;
  buckets?: Record<string, BucketConfig>;
  fetcher?: typeof fetch;
  log?: (line: string) => void;
  token: string;
}): Promise<BucketPlan[]> => {
  const accountId = options.accountId ?? DEFAULT_ACCOUNT_ID;
  const log = options.log ?? console.log;
  const { call } = cloudflareClient(options.token, options.fetcher ?? fetch);
  const plans: BucketPlan[] = [];

  for (const [bucket, config] of Object.entries(
    options.buckets ?? R2_BUCKETS
  )) {
    const lifecyclePath = `/accounts/${accountId}/r2/buckets/${bucket}/lifecycle`;
    const live =
      (await call<{ rules?: LifecycleRule[] }>("GET", lifecyclePath)).result
        ?.rules ?? [];
    const lifecycle = planLifecycle(live, config.lifecycle);

    const notificationPath = `/accounts/${accountId}/event_notifications/r2/${bucket}/configuration`;
    const liveNotifications =
      (
        await call<NotificationConfig>("GET", notificationPath, undefined, {
          allowMissing: true,
        })
      ).result?.queues ?? [];
    const notifications: BucketPlan["notifications"] = {};
    for (const [queueName, rules] of Object.entries(config.notifications)) {
      const liveRules =
        liveNotifications.find((queue) => queue.queueName === queueName)
          ?.rules ?? [];
      notifications[queueName] = planNotifications(liveRules, rules);
    }
    const plan: BucketPlan = { bucket, lifecycle, notifications };
    plans.push(plan);

    for (const rule of lifecycle.create) {
      log(`${bucket}: create  lifecycle ${rule.id}`);
    }
    for (const { rule } of lifecycle.update) {
      log(`${bucket}: update  lifecycle ${rule.id}`);
    }
    for (const rule of lifecycle.remove) {
      log(`${bucket}: delete  lifecycle ${rule.id}`);
    }
    for (const rule of lifecycle.unchanged) {
      log(`${bucket}: same    lifecycle ${rule.id}`);
    }
    for (const rule of live.filter(
      (candidate) => !candidate.id.startsWith(R2_RULE_PREFIX)
    )) {
      log(`${bucket}: keep    lifecycle ${rule.id} (not managed here)`);
    }
    for (const [queueName, queuePlan] of Object.entries(notifications)) {
      for (const rule of queuePlan.create) {
        log(
          `${bucket}: create  notification ${rule.description} → ${queueName}`
        );
      }
      for (const { rule } of queuePlan.update) {
        log(
          `${bucket}: update  notification ${rule.description} → ${queueName}`
        );
      }
      for (const rule of queuePlan.remove) {
        log(
          `${bucket}: delete  notification ${rule.description} → ${queueName}`
        );
      }
      for (const rule of queuePlan.unchanged) {
        log(
          `${bucket}: same    notification ${rule.description} → ${queueName}`
        );
      }
    }

    if (!(options.apply && bucketHasChanges(plan))) {
      continue;
    }
    if (hasChanges(lifecycle)) {
      await call("PUT", lifecyclePath, {
        rules: lifecycleRulesToPut(live, config.lifecycle),
      });
    }
    for (const [queueName, queuePlan] of Object.entries(notifications)) {
      if (!hasChanges(queuePlan)) {
        continue;
      }
      const queues = await call<Array<{ queue_id: string }>>(
        "GET",
        `/accounts/${accountId}/queues?name=${encodeURIComponent(queueName)}`
      );
      const queueId = queues.result?.[0]?.queue_id;
      if (!queueId) {
        throw new Error(`Queue ${queueName} does not exist; create it first`);
      }
      const queuePath = `${notificationPath}/queues/${queueId}`;
      const stale = [
        ...queuePlan.remove,
        ...queuePlan.update.map(({ live: current }) => current),
      ].map((rule) => rule.ruleId);
      if (stale.length > 0) {
        await call("DELETE", queuePath, { ruleIds: stale });
      }
      const fresh = [
        ...queuePlan.create,
        ...queuePlan.update.map(({ rule }) => rule),
      ];
      if (fresh.length > 0) {
        await call("PUT", queuePath, { rules: fresh });
      }
    }
  }
  return plans;
};

if (import.meta.main) {
  const args = new Set(process.argv.slice(2));
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    console.error(
      "CLOUDFLARE_API_TOKEN is not set (Workers R2 Storage: Edit and Queues: Read on the account)."
    );
    process.exit(2);
  }
  const apply = args.has("--apply");
  const plans = await syncR2Buckets({ apply, token });
  if (!apply && plans.some(bucketHasChanges)) {
    console.log("Dry run: re-run with --apply to make these changes.");
    if (args.has("--check")) {
      process.exit(1);
    }
  }
}
