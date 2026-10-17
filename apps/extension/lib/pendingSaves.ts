import { isPrivateSession } from "./privateSession";
import type { FileUploadInput } from "./saveFileToTeak";
import type { SaveToTeakInput } from "./saveToTeak";

export type PendingSave = {
  id: string;
  createdAt: number;
  firstAttemptAt?: number;
  ownerId?: string;
} & (
  | { kind: "content"; input: SaveToTeakInput }
  | { kind: "asset"; assetUrl: string }
  | { kind: "file"; input: FileUploadInput }
);

const MAX_PENDING_SAVES = 20;
const TOO_MANY_PENDING = "Finish your pending saves before adding more.";
// In a private session (see isPrivateSession), saves wait here instead.
const memory = new Map<string, PendingSave>();

// IndexedDB preserves file Blobs across popup closure and worker restarts.
// It belongs to the extension origin; page content scripts cannot access it.
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("teak-pending-saves", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("saves", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = database.transaction("saves", mode);
      const request = operation(tx.objectStore("saves"));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () =>
        reject(tx.error ?? new Error("Could not preserve the pending save."));
    });
  } finally {
    database.close();
  }
}

export const listPendingSaveIds = async () =>
  isPrivateSession()
    ? [...memory.keys()]
    : ((await transaction("readonly", (store) =>
        store.getAllKeys()
      )) as string[]);
export const waitingSaveIds = (
  ids: readonly string[],
  running: { has: (id: string) => boolean }
) => ids.filter((id) => !running.has(id));
export const getPendingSave = async (id: string) =>
  isPrivateSession()
    ? memory.get(id)
    : ((await transaction("readonly", (store) => store.get(id))) as
        | PendingSave
        | undefined);
export const removePendingSave = async (id: string) => {
  if (isPrivateSession()) {
    memory.delete(id);
  } else {
    await transaction("readwrite", (store) => store.delete(id));
  }
  await notifyQueueChange();
};
export const updatePendingSave = async (save: PendingSave) => {
  if (isPrivateSession()) {
    memory.set(save.id, save);
    return;
  }
  await transaction("readwrite", (store) => store.put(save));
};
const notifyQueueChange = () =>
  chrome.storage.local.set({ teakPendingSaveChanged: Date.now() });

export async function storePendingSave(save: PendingSave) {
  if (isPrivateSession()) {
    if (memory.size >= MAX_PENDING_SAVES) {
      throw new Error(TOO_MANY_PENDING);
    }
    memory.set(save.id, save);
    await notifyQueueChange();
    return;
  }
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction("saves", "readwrite");
      const store = tx.objectStore("saves");
      const count = store.count();
      let failure: Error | null = null;
      count.onsuccess = () => {
        if (count.result >= MAX_PENDING_SAVES) {
          failure = new Error(TOO_MANY_PENDING);
          tx.abort();
        } else {
          store.add(save);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () =>
        reject(
          failure ??
            tx.error ??
            new Error("Could not preserve the pending save.")
        );
    });
  } finally {
    database.close();
  }
  await notifyQueueChange();
}
