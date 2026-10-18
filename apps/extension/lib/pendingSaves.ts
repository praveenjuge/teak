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

interface PendingSaveStore {
  add: (save: PendingSave) => Promise<void>;
  get: (id: string) => Promise<PendingSave | undefined>;
  ids: () => Promise<string[]>;
  put: (save: PendingSave) => Promise<void>;
  remove: (id: string) => Promise<void>;
  retainsFiles: boolean;
}

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

const durableStore: PendingSaveStore = {
  retainsFiles: true,
  ids: async () =>
    (await transaction("readonly", (store) => store.getAllKeys())) as string[],
  get: async (id) =>
    (await transaction("readonly", (store) => store.get(id))) as
      | PendingSave
      | undefined,
  put: async (save) => {
    await transaction("readwrite", (store) => store.put(save));
  },
  remove: async (id) => {
    await transaction("readwrite", (store) => store.delete(id));
  },
  add: async (save) => {
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
  },
};

const SESSION_KEY = "teakPendingSaves";
type SessionSaves = Record<string, PendingSave>;
const files = new Map<string, PendingSave>();
const readSession = async () =>
  ((await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY] ??
    {}) as SessionSaves;
let sessionWrites: Promise<unknown> = Promise.resolve();
const editSession = (edit: (saves: SessionSaves) => void) => {
  const write = sessionWrites.then(async () => {
    const saves = await readSession();
    edit(saves);
    await chrome.storage.session.set({ [SESSION_KEY]: saves });
  });
  sessionWrites = write.catch(() => undefined);
  return write;
};

const privateSessionStore: PendingSaveStore = {
  retainsFiles: false,
  ids: async () => [...Object.keys(await readSession()), ...files.keys()],
  get: async (id) => files.get(id) ?? (await readSession())[id],
  put: async (save) => {
    if (save.kind === "file") {
      files.set(save.id, save);
      return;
    }
    await editSession((saves) => {
      saves[save.id] = save;
    });
  },
  remove: async (id) => {
    files.delete(id);
    await editSession((saves) => {
      delete saves[id];
    });
  },
  add: async (save) => {
    if (save.kind === "file") {
      if ((await privateSessionStore.ids()).length >= MAX_PENDING_SAVES) {
        throw new Error(TOO_MANY_PENDING);
      }
      files.set(save.id, save);
      return;
    }
    await editSession((saves) => {
      if (Object.keys(saves).length + files.size >= MAX_PENDING_SAVES) {
        throw new Error(TOO_MANY_PENDING);
      }
      saves[save.id] = save;
    });
  },
};

export const pendingSaveStore = (): PendingSaveStore =>
  isPrivateSession() ? privateSessionStore : durableStore;

export const listPendingSaveIds = () => pendingSaveStore().ids();
export const waitingSaveIds = (
  ids: readonly string[],
  running: { has: (id: string) => boolean }
) => ids.filter((id) => !running.has(id));
export const getPendingSave = (id: string) => pendingSaveStore().get(id);
export const removePendingSave = async (id: string) => {
  await pendingSaveStore().remove(id);
  await notifyQueueChange();
};
export const updatePendingSave = (save: PendingSave) =>
  pendingSaveStore().put(save);
const notifyQueueChange = () =>
  chrome.storage.local.set({ teakPendingSaveChanged: Date.now() });

export async function storePendingSave(save: PendingSave) {
  await pendingSaveStore().add(save);
  await notifyQueueChange();
}
