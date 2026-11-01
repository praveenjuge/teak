import { afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useCardsSearchController } = await import(
  "../useCardsSearchController"
);

type Controller = ReturnType<typeof useCardsSearchController>;
type Options = Parameters<typeof useCardsSearchController>[0];

let root: Root | undefined;
let controller: Controller;

function Harness(props: { options: Options }) {
  controller = useCardsSearchController(props.options);
  return null;
}

async function render(options: Options) {
  const container = document.createElement("div");
  document.body.append(container);
  root = root ?? createRoot(container);
  await act(() => root?.render(<Harness options={options} />));
}

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const card = (
  id: string,
  content: string,
  extra: Partial<Doc<"cards">> = {}
): Doc<"cards"> =>
  ({
    _id: id as Id<"cards">,
    _creationTime: 1,
    content,
    createdAt: 1,
    type: "text",
    updatedAt: 1,
    userId: "owner",
    ...extra,
  }) as Doc<"cards">;

const SMART = "folder_smart" as Id<"folders">;

test("in a smart folder, instant local hits must match its search too", async () => {
  await render({ folderId: SMART, folderQuery: "tag:design" });
  expect(controller.queryArgs).toMatchObject({
    folderId: SMART,
    folderQuery: "tag:design",
  });
  await act(() =>
    controller.setRemoteCards(
      [
        card("a", "notes on grids", { tags: ["design"] }),
        card("b", "notes on taxes"),
      ],
      "seen"
    )
  );
  await act(() => controller.searchBarProps.onSearchChange("notes"));
  expect(controller.displayCards.map((item) => item._id)).toEqual(["a"]);
});

test("a typed search that contradicts the smart folder shows no local hits", async () => {
  await render({ folderId: SMART, folderQuery: "type:link" });
  await act(() =>
    controller.setRemoteCards([card("a", "notes", { type: "image" })], "seen")
  );
  await act(() => controller.searchBarProps.onSearchChange("type:image notes"));
  expect(controller.displayCards).toEqual([]);
});

test("a smart folder shows only the cards its saved search shows", async () => {
  // The server's word index matches any word of `verify-navx`, so it can
  // send cards that hold only `verify`; the saved search drops them, and so
  // must the folder, before anything is typed.
  const fromServer = [
    card("match", "verify-navx kestrel"),
    card("other-agent", "verify-capx kestrel"),
    card("excluded", "verify-navx heron"),
  ];
  await render({ folderId: SMART, folderQuery: "verify-navx -heron" });
  await act(() => controller.setRemoteCards(fromServer, "folder"));
  const inFolder = controller.displayCards.map((item) => item._id);

  await act(() => root?.unmount());
  root = undefined;
  await render({});
  await act(() =>
    controller.searchBarProps.onSearchChange("verify-navx -heron")
  );
  await act(() => controller.setRemoteCards(fromServer, "search"));
  const searched = controller.displayCards.map((item) => item._id);

  expect(inFolder).toEqual(["match"]);
  expect(inFolder).toEqual(searched);
});

test("a smart folder keeps a card the server matched by meaning", async () => {
  await render({ folderId: SMART, folderQuery: "kestrel" });
  await act(() =>
    controller.setRemoteCards(
      [
        card("word", "a kestrel hovering"),
        { ...card("meaning", "a small falcon"), matchedByMeaning: true },
      ] as Doc<"cards">[],
      JSON.stringify(controller.queryArgs)
    )
  );
  expect(controller.displayCards.map((item) => item._id).sort()).toEqual([
    "meaning",
    "word",
  ]);
});

test("counts cards found only by meaning, and can leave them out", async () => {
  await render({});
  await act(() => controller.searchBarProps.onSearchChange("verify-navx"));
  await act(
    () => new Promise((resolve) => setTimeout(resolve, 250)) // the debounce
  );
  await act(() =>
    controller.setRemoteCards(
      [
        card("word", "verify-navx notes"),
        { ...card("meaning", "verify-capx notes"), matchedByMeaning: true },
      ] as Doc<"cards">[],
      JSON.stringify(controller.queryArgs)
    )
  );
  expect(controller.exactCount).toBe(1);
  expect(controller.relatedCount).toBe(1);
  expect(controller.displayCards).toHaveLength(2);

  await act(() => controller.setShowRelated(false));
  expect(controller.displayCards.map((item) => item._id)).toEqual(["word"]);
  expect(controller.relatedCount).toBe(1);
});
