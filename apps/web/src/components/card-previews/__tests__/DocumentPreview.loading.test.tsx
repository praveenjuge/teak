import { expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { DocumentPreview } = await import("../DocumentPreview");

test("a PDF pulses until its frame has loaded", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(() =>
    root.render(
      <DocumentPreview
        card={
          {
            _creationTime: 1,
            _id: "card_doc",
            content: "Invoice",
            createdAt: 1,
            fileMetadata: {
              fileName: "invoice.pdf",
              mimeType: "application/pdf",
            },
            fileUrl: "https://files.example.com/invoice.pdf",
            type: "document",
            updatedAt: 1,
            userId: "user_a",
          } as never
        }
      />
    )
  );
  expect(container.querySelector('[data-slot="media-loading"]')).not.toBeNull();

  await act(() => {
    container.querySelector("iframe")?.dispatchEvent(new Event("load"));
  });
  expect(container.querySelector('[data-slot="media-loading"]')).toBeNull();
  expect(container.querySelector("iframe")).not.toBeNull();
  await act(() => root.unmount());
});
