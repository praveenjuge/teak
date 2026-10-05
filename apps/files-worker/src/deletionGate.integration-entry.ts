import { gatedBucket, freezeObject } from "./deletionGate";
export { ObjectDeletionGate } from "./deletionGate";
export default {
  async fetch(request: Request, env: { BUCKET: R2Bucket; OBJECT_GATES: DurableObjectNamespace }) {
    const path = new URL(request.url).pathname;
    const key = "users/exact-owner/account-deletion-e2e";
    if (path === "/freeze") return Response.json({ frozen: await freezeObject(env, key) });
    if (path === "/read") return Response.json({ present: Boolean(await env.BUCKET.head(key)) });
    if (path === "/delete") { await env.BUCKET.delete(key); return new Response("deleted"); }
    try {
      await gatedBucket(env).put(key, request.body);
      return new Response("written");
    } catch { return new Response("fenced", { status: 409 }); }
  },
};
