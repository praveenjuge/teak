import { ConvexReactClient } from "convex/react";
import { getFunctionName } from "convex/server";

interface Subscription {
  args: Record<string, unknown>;
  callbacks: Set<() => void>;
  path: string;
  result: unknown;
  started: boolean;
}
interface Call {
  args: Record<string, unknown>;
  kind: "action" | "mutation";
  path: string;
}

// Substitute only the external Convex transport. The provider and cached hooks stay real.
export function createConvexTransport() {
  const client = new ConvexReactClient("https://fixture.convex.cloud", {
    logger: false,
  });
  const subscriptions = new Map<string, Subscription>();
  const defaults = new Map<string, unknown>();
  const requests: Subscription[] = [];
  const calls: Call[] = [];
  let invoke: (call: Call) => Promise<unknown> = async () => null;
  client.watchQuery = ((query, args = {}) => {
    const path = getFunctionName(query);
    const key = JSON.stringify([path, args]);
    let subscription = subscriptions.get(key);
    if (!subscription) {
      subscription = {
        path,
        args,
        callbacks: new Set(),
        result: defaults.get(path),
        started: false,
      };
      subscriptions.set(key, subscription);
    }
    const entry = subscription;
    return {
      journal: () => undefined,
      localQueryResult: () => {
        if (entry.result instanceof Error) {
          throw entry.result;
        }
        return entry.result;
      },
      onUpdate: (callback: () => void) => {
        entry.callbacks.add(callback);
        if (!entry.started) {
          entry.started = true;
          requests.push(entry);
        }
        return () => entry.callbacks.delete(callback);
      },
    };
  }) as typeof client.watchQuery;
  const send =
    (kind: Call["kind"]) =>
    async (
      query: Parameters<typeof getFunctionName>[0],
      args: Record<string, unknown> = {}
    ) => {
      const call = { kind, path: getFunctionName(query), args };
      calls.push(call);
      return await invoke(call);
    };
  client.action = send("action") as typeof client.action;
  client.mutation = send("mutation") as typeof client.mutation;
  return {
    client,
    requests,
    calls,
    onCall: (handler: typeof invoke) => {
      invoke = handler;
    },
    seed: (path: string, result: unknown) => {
      defaults.set(path, result);
    },
    reply: (
      path: string,
      result: unknown,
      match: (args: Record<string, unknown>) => boolean = () => true
    ) => {
      for (const entry of subscriptions.values()) {
        if (entry.path === path && match(entry.args)) {
          entry.result = result;
          for (const callback of entry.callbacks) {
            callback();
          }
        }
      }
    },
  };
}
