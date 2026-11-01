import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";
import type { CardModalCard } from "../types";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const realFolders = await import("../../../hooks/useFolders");
mock.module("../../../hooks/useFolders", () => ({
  ...realFolders,
  useFolders: () => [{ _id: "folder_1", name: "Moodboard" }],
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CardMetadataPanel, DETAILS_EXPANDED_KEY } = await import(
  "../CardMetadataPanel"
);

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  window.localStorage.clear();
});

const imageCard = (extra: Partial<CardModalCard> = {}) =>
  ({
    _id: "card_1",
    _creationTime: 0,
    aiTags: ["petal", "pollen", "macro"],
    content: "",
    createdAt: 0,
    fileMetadata: {
      fileName: "lily.webp",
      fileSize: 2048,
      mimeType: "image/webp",
    },
    tags: ["flowers"],
    type: "image",
    updatedAt: 0,
    userId: "user_1",
    ...extra,
  }) as unknown as CardModalCard;

async function render(
  card: CardModalCard,
  extra: Partial<Parameters<typeof CardMetadataPanel>[0]> = {}
) {
  const tags = {
    acceptAiTag: mock(),
    addTag: mock(),
    removeAiTag: mock(),
    removeTag: mock(),
    setTagInput: mock(),
    tagInput: "",
  };
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(() =>
    root?.render(
      <CardMetadataPanel
        card={card}
        getCurrentValue={(field) => card[field as keyof CardModalCard] as never}
        onCommit={() => undefined}
        onNotesChange={() => undefined}
        tags={tags}
        {...extra}
      />
    )
  );
  return { tags };
}

const button = (name: string) =>
  Array.from(document.querySelectorAll("button")).find(
    (element) =>
      element.getAttribute("aria-label") === name ||
      element.textContent?.trim() === name
  );
const detailLabels = () =>
  Array.from(document.querySelectorAll("dt")).map((dt) => dt.textContent);

test("Details shows Added and File size, and the rest behind More details", async () => {
  await render(imageCard());
  expect(detailLabels()).toEqual(["Added", "File size"]);

  await act(() => button("More details")?.click());
  expect(detailLabels()).toEqual([
    "Added",
    "File size",
    "File name",
    "File type",
  ]);
  expect(button("Fewer details")?.getAttribute("aria-expanded")).toBe("true");
});

test("Details stays open on the next card once someone opened it", async () => {
  await render(imageCard());
  await act(() => button("More details")?.click());
  await act(() => root?.unmount());
  root = undefined;

  await render(imageCard({ _id: "card_2" } as Partial<CardModalCard>));
  expect(detailLabels()).toContain("File name");
  expect(window.localStorage.getItem(DETAILS_EXPANDED_KEY)).toBe("1");
});

test("tags Teak suggested stay folded until opened, and can be kept or removed", async () => {
  const { tags } = await render(imageCard());
  expect(button("Keep tag petal")).toBeUndefined();

  const toggle = button("3 suggested tags");
  expect(toggle?.getAttribute("aria-expanded")).toBe("false");
  await act(() => toggle?.click());

  await act(() => button("Keep tag petal")?.click());
  expect(tags.acceptAiTag).toHaveBeenCalledWith("petal");
  await act(() => button("Remove Teak tag macro")?.click());
  expect(tags.removeAiTag).toHaveBeenCalledWith("macro");
});

test("a suggested tag in Arabic or Japanese runs in its own direction", async () => {
  await render(imageCard({ aiTags: ["تطبيق", "デザイン"] }));
  await act(() => button("2 suggested tags")?.click());
  for (const tag of ["تطبيق", "デザイン"]) {
    const label = button(`Keep tag ${tag}`)?.querySelector("span[dir]");
    expect(label?.textContent).toBe(tag);
    expect(label?.getAttribute("dir")).toBe("auto");
  }
});

test("a suggestion the card already has as its own tag isn't suggested", async () => {
  await render(imageCard({ tags: ["petal"] }));
  expect(button("2 suggested tags")).toBeDefined();
});

test("a card in a folder shows the folder among its tags, which changes folders", async () => {
  const onOpenFolders = mock();
  await render(imageCard({ folderIds: ["folder_1"] } as never), {
    onOpenFolders,
  });
  await act(() => button("In Moodboard. Change folders")?.click());
  expect(onOpenFolders).toHaveBeenCalledTimes(1);
  expect(button("Add to a folder")).toBeUndefined();
});

test("a card in no folder offers Add to a folder", async () => {
  const onOpenFolders = mock();
  await render(imageCard(), { onOpenFolders });
  await act(() => button("Add to a folder")?.click());
  expect(onOpenFolders).toHaveBeenCalledTimes(1);
});

const linkCard = () =>
  imageCard({
    aiTags: [],
    fileMetadata: undefined,
    type: "link",
    url: "https://example.com/lamp",
  } as Partial<CardModalCard>);

test("a link's URL row offers Edit link, and its Image row Replace", async () => {
  const onEditLink = mock();
  const onReplace = mock();
  await render(linkCard(), {
    image: { busy: false, onReplace },
    onEditLink,
  });
  await act(() => button("Edit link…")?.click());
  expect(onEditLink).toHaveBeenCalledTimes(1);
  expect(detailLabels()).toContain("Image");
  expect(button("Replace image")?.textContent).toBe("Replace");
  await act(() => button("Replace image")?.click());
  expect(onReplace).toHaveBeenCalledTimes(1);
  expect(button("Reset to original image")).toBeUndefined();
});

test("a replaced image offers Reset, and both wait while one is busy", async () => {
  const onReset = mock();
  await render(linkCard(), {
    image: { busy: true, onReplace: mock(), onReset },
  });
  expect(button("Reset to original image")?.textContent).toBe("Reset");
  expect(button("Reset to original image")?.disabled).toBe(true);
  expect(button("Replace image")?.disabled).toBe(true);
});

test("without the controls, Details has neither Edit link nor Image", async () => {
  await render(linkCard());
  expect(button("Edit link…")).toBeUndefined();
  expect(detailLabels()).not.toContain("Image");
});
