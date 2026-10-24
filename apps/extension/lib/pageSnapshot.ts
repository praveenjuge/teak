import { PAGE_SNAPSHOT_MAX_BYTES } from "@teak/convex/shared/pageArchive";

/**
 * The page as the browser shows it, sent with a link save so Teak's saved
 * copy is what the person saw: pages behind a sign-in, or built by scripts,
 * included. Gzipped here; Teak inlines its styles and images itself.
 */
export interface PageSnapshot {
  /** The page's HTML, gzipped. */
  gzip: Uint8Array<ArrayBuffer>;
  /** Where the tab was when the page was read. */
  url: string;
}

/** A snapshot that takes longer than this is skipped, never waited for. */
export const PAGE_SNAPSHOT_TIMEOUT_MS = 3000;
/** Markup past this many characters isn't worth compressing. */
const MAX_HTML_CHARACTERS = 60 * 1024 * 1024;

/**
 * Runs inside the page, so it must stand alone: no imports, no closures.
 * Clones the rendered document, copies each form control's live state into
 * the clone except for anything secret (passwords, hidden inputs, one-time
 * codes and payment cards), drops scripts, and names the page with
 * `<base href>` so its relative URLs still resolve.
 */
export function serializeRenderedPage(): { html: string; url: string } {
  const SECRET_AUTOCOMPLETE =
    /^(?:current-password|new-password|one-time-code|cc-.+)$/u;
  const isSecret = (control: Element): boolean => {
    const type = (control.getAttribute("type") ?? "").toLowerCase();
    if (
      control.tagName === "INPUT" &&
      (type === "password" || type === "hidden")
    ) {
      return true;
    }
    return (control.getAttribute("autocomplete") ?? "")
      .toLowerCase()
      .split(/\s+/u)
      .some((token) => SECRET_AUTOCOMPLETE.test(token));
  };

  const source = document.documentElement;
  const clone = source.cloneNode(true) as HTMLElement;
  const live = source.querySelectorAll("input, textarea, select");
  const copies = clone.querySelectorAll("input, textarea, select");
  live.forEach((control, index) => {
    const copy = copies[index];
    if (!copy || copy.tagName !== control.tagName) {
      return;
    }
    const secret = isSecret(control) || isSecret(copy);
    if (control instanceof HTMLInputElement) {
      const type = control.type.toLowerCase();
      if (type === "checkbox" || type === "radio") {
        if (control.checked) {
          copy.setAttribute("checked", "");
        } else {
          copy.removeAttribute("checked");
        }
      } else if (secret || type === "file") {
        copy.removeAttribute("value");
      } else {
        copy.setAttribute("value", control.value);
      }
      return;
    }
    if (control instanceof HTMLTextAreaElement) {
      copy.textContent = secret ? "" : control.value;
      return;
    }
    if (control instanceof HTMLSelectElement) {
      const options = copy.querySelectorAll("option");
      Array.from(control.options).forEach((option, optionIndex) => {
        const target = options[optionIndex];
        if (secret || !option.selected) {
          target?.removeAttribute("selected");
        } else {
          target?.setAttribute("selected", "");
        }
      });
    }
  });
  for (const node of Array.from(
    clone.querySelectorAll("script, noscript, template")
  )) {
    node.remove();
  }

  let head = clone.querySelector("head");
  if (!head) {
    head = document.createElement("head");
    clone.insertBefore(head, clone.firstChild);
  }
  const pageBase = document.querySelector(
    "base[href]"
  ) as HTMLBaseElement | null;
  const cloneBase = clone.querySelector("base[href]");
  if (pageBase && cloneBase) {
    cloneBase.setAttribute("href", pageBase.href);
  } else {
    const base = document.createElement("base");
    base.setAttribute("href", location.href);
    head.prepend(base);
  }

  const doctype = document.doctype ? `<!doctype ${document.doctype.name}>` : "";
  return { html: `${doctype}${clone.outerHTML}`, url: location.href };
}

export const gzipText = async (
  text: string
): Promise<Uint8Array<ArrayBuffer>> =>
  new Uint8Array(
    await new Response(
      new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))
    ).arrayBuffer()
  );

type ExecuteScript = (injection: {
  func: typeof serializeRenderedPage;
  target: { tabId: number };
}) => Promise<Array<{ result?: unknown }>>;

export interface CapturePageSnapshotDependencies {
  executeScript?: ExecuteScript;
  timeoutMs?: number;
}

const isSerializedPage = (
  value: unknown
): value is { html: string; url: string } =>
  Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { html?: unknown }).html === "string" &&
      typeof (value as { url?: unknown }).url === "string"
  );

/**
 * The tab's page, gzipped, or null: a page the extension can't read, one
 * over 20 MiB gzipped, or one that takes more than 3 seconds. A snapshot
 * never holds up a save.
 */
export async function capturePageSnapshot(
  tabId: number,
  dependencies: CapturePageSnapshotDependencies = {}
): Promise<PageSnapshot | null> {
  const executeScript: ExecuteScript =
    dependencies.executeScript ??
    ((injection) =>
      chrome.scripting.executeScript(injection) as Promise<
        Array<{ result?: unknown }>
      >);
  const capture = async (): Promise<PageSnapshot | null> => {
    const [first] = await executeScript({
      func: serializeRenderedPage,
      target: { tabId },
    });
    const page = first?.result;
    if (!isSerializedPage(page) || page.html.length > MAX_HTML_CHARACTERS) {
      return null;
    }
    const gzip = await gzipText(page.html);
    return gzip.byteLength > PAGE_SNAPSHOT_MAX_BYTES
      ? null
      : { gzip, url: page.url };
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(
      () => resolve(null),
      dependencies.timeoutMs ?? PAGE_SNAPSHOT_TIMEOUT_MS
    );
  });
  try {
    return await Promise.race([capture().catch(() => null), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export interface UploadPageSnapshotDependencies {
  fetchImpl?: typeof fetch;
  /** An authorized request to Teak's API: null when signed out. */
  request: (path: string, init?: RequestInit) => Promise<Response | null>;
}

/**
 * Uploads a snapshot to Teak and returns its key for `POST /v1/cards`, or
 * null when anything goes wrong: the save then goes on without it.
 */
export async function uploadPageSnapshot(
  snapshot: PageSnapshot,
  { fetchImpl = fetch, request }: UploadPageSnapshotDependencies
): Promise<string | null> {
  try {
    const prepared = await request("/v1/page-snapshots/upload", {
      body: JSON.stringify({ bytes: snapshot.gzip.byteLength }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    if (!prepared?.ok) {
      return null;
    }
    const upload = (await prepared.json()) as {
      fileKey?: unknown;
      uploadUrl?: unknown;
    };
    if (
      typeof upload.fileKey !== "string" ||
      typeof upload.uploadUrl !== "string"
    ) {
      return null;
    }
    const put = await fetchImpl(upload.uploadUrl, {
      body: snapshot.gzip,
      headers: { "Content-Type": "application/gzip" },
      method: "PUT",
    });
    return put.ok ? upload.fileKey : null;
  } catch (error) {
    console.warn("Teak: page snapshot upload failed", error);
    return null;
  }
}
