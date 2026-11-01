import { afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { Dialog, DialogContent } = await import("@/components/ui/dialog");
const { SidebarTitle } = await import("../CardSidebarHeader");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const renderTitle = async (
  saveStatus: { error: boolean; label: string } | null
) => {
  root ??= createRoot(document.body.appendChild(document.createElement("div")));
  await act(() =>
    root?.render(
      <Dialog open>
        <DialogContent>
          <SidebarTitle
            added="Added today at 1:42 PM"
            editable={false}
            label="Title"
            onCommit={() => undefined}
            onTitleChange={() => undefined}
            placeholder="Title"
            saveStatus={saveStatus}
            showTitle={false}
            title="Note"
            titleValue=""
            typeIcon={null}
            typeLabel="Text"
            typeTitle="Show all Text cards"
          />
        </DialogContent>
      </Dialog>
    )
  );
  return document.body.querySelector('[role="status"]');
};

test("the save status is one live region that's there before anything is saved", async () => {
  const idle = await renderTitle(null);
  expect(idle).not.toBeNull();
  expect(idle?.textContent).toBe("");

  const saving = await renderTitle({ error: false, label: "Saving…" });
  expect(saving).toBe(idle);
  expect(saving?.textContent).toBe("Saving…");

  const failed = await renderTitle({ error: true, label: "Couldn't save" });
  expect(failed).toBe(idle);
  expect(failed?.textContent).toBe("Couldn't save");
  expect(failed?.className).toContain("text-destructive");
});
