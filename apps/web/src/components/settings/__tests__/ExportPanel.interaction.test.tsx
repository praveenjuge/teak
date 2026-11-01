import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

mock.module("sonner", () => ({
  toast: { error: mock(), loading: mock(() => "toast-id"), success: mock() },
}));

const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CANCEL_AFTER_START_GUARD_MS, ExportPanel } = await import(
  "../ExportPanel"
);
type ExportState = import("../ExportPanel").ExportState;

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const running: ExportState = {
  job: {
    id: "job_1",
    status: "running",
    createdAt: 1,
    updatedAt: 1,
    downloadAvailable: false,
  },
  canStartNew: false,
  quotaResetMs: 0,
};

function Fixture({ onCancel }: { onCancel: (id: string) => void }) {
  const [state, setState] = useState<ExportState>({
    job: null,
    canStartNew: true,
    quotaResetMs: 0,
  });
  return (
    <ExportPanel
      exportState={state}
      isLoading={false}
      onCancelExport={(id) => {
        onCancel(id);
        return Promise.resolve();
      }}
      onDownloadExport={() => Promise.resolve()}
      onStartExport={() => {
        setState(running);
        return Promise.resolve();
      }}
    />
  );
}

const button = () => {
  const match = document.querySelector("button");
  if (!match) {
    throw new Error("No button");
  }
  return match;
};

const click = () =>
  act(async () => {
    button().click();
    await Promise.resolve();
  });

test("the second click of a double-click doesn't cancel the export it started", async () => {
  const onCancel = mock((_id: string) => undefined);
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(() => root?.render(<Fixture onCancel={onCancel} />));
  expect(button().textContent).toBe("Start export");

  await click();
  expect(button().textContent).toBe("Cancel export");
  await click();
  expect(onCancel).not.toHaveBeenCalled();

  const realNow = Date.now;
  Date.now = () => realNow() + CANCEL_AFTER_START_GUARD_MS + 1;
  try {
    await click();
  } finally {
    Date.now = realNow;
  }
  expect(onCancel).toHaveBeenCalledWith("job_1");
});

test("a ready export still says when the next export can start", async () => {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(() =>
    root?.render(
      <ExportPanel
        exportState={{
          job: {
            id: "job_ready",
            status: "ready",
            cardCount: 3,
            createdAt: 1,
            updatedAt: 2,
            downloadAvailable: true,
          },
          canStartNew: false,
          quotaResetMs: 3 * 24 * 60 * 60 * 1000,
        }}
        isLoading={false}
        onCancelExport={() => Promise.resolve()}
        onDownloadExport={() => Promise.resolve()}
        onStartExport={() => Promise.resolve()}
      />
    )
  );
  expect(document.body.textContent).toContain("Your export is ready");
  expect(document.body.textContent).toMatch(/Next export available \w{3}/);
});
