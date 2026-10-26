import { FOCUS_COMPOSER_PARAM } from "@/lib/libraryViews";
import {
  SHARE_CACHE,
  SHARE_FILE_NAME_HEADER,
  SHARE_FILE_PREFIX,
  SHARE_FILES_MAX_AGE_MS,
  SHARE_FILES_MISSING,
  SHARE_FILES_PARAM,
  SHARE_TEXT_FIELDS,
  SHARE_TEXT_LIMIT,
} from "./sharedContent";

/**
 * The service worker's source, served at `/sw.js`. It has one job: take a
 * POST from the system share sheet to `/share`, keep its files in Cache
 * Storage, and send the app to the library with the text in the URL. It
 * caches nothing else and has no offline page.
 */
export const shareWorkerSource = `"use strict";
const CACHE = ${JSON.stringify(SHARE_CACHE)};
const PREFIX = ${JSON.stringify(SHARE_FILE_PREFIX)};
const MAX_AGE = ${SHARE_FILES_MAX_AGE_MS};
const TEXT_FIELDS = ${JSON.stringify(SHARE_TEXT_FIELDS)};
const TEXT_LIMIT = ${SHARE_TEXT_LIMIT};
const COMPOSE = ${JSON.stringify(FOCUS_COMPOSER_PARAM)};

const prune = async () => {
  const cache = await caches.open(CACHE);
  for (const request of await cache.keys()) {
    const id = new URL(request.url).pathname.slice(PREFIX.length).split("/")[0];
    const savedAt = Number(id.split("-")[0]);
    if (!(Date.now() - savedAt < MAX_AGE)) await cache.delete(request);
  }
};

const library = (params) =>
  Response.redirect(new URL("/?" + params.toString(), self.location.origin).href, 303);

const share = async (request) => {
  const form = await request.formData();
  const params = new URLSearchParams({ [COMPOSE]: "1" });
  for (const field of TEXT_FIELDS) {
    const value = form.get(field);
    if (typeof value === "string" && value.trim()) params.set(field, value.trim().slice(0, TEXT_LIMIT));
  }
  const files = form.getAll("files").filter((file) => typeof file !== "string" && file.size > 0);
  if (files.length > 0) {
    params.set(${JSON.stringify(SHARE_FILES_PARAM)}, await keep(files));
  }
  return library(params);
};

// Keeps the files under a new id, or says they're missing (a full quota, say);
// the text goes to the composer either way.
const keep = async (files) => {
  const id = Date.now() + "-" + crypto.randomUUID();
  try {
    await prune();
    const cache = await caches.open(CACHE);
    await Promise.all(files.map((file, index) => cache.put(PREFIX + id + "/" + index, new Response(file, {
      headers: {
        "content-type": file.type || "application/octet-stream",
        ${JSON.stringify(SHARE_FILE_NAME_HEADER)}: encodeURIComponent(file.name),
      },
    }))));
    return id;
  } catch {
    const cache = await caches.open(CACHE).catch(() => null);
    for (const index of files.keys()) await cache?.delete(PREFIX + id + "/" + index).catch(() => false);
    return ${JSON.stringify(SHARE_FILES_MISSING)};
  }
};

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([self.clients.claim(), prune()]));
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || url.origin !== self.location.origin || url.pathname !== "/share") return;
  event.respondWith(share(event.request).catch(() =>
    library(new URLSearchParams({ [COMPOSE]: "1", ${JSON.stringify(SHARE_FILES_PARAM)}: ${JSON.stringify(SHARE_FILES_MISSING)} }))
  ));
});
`;
