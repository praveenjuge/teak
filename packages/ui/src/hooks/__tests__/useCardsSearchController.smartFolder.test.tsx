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
  // No card is in a smart folder; it shows whatever matches its search.
  expect(controller.queryArgs.folderId).toBe(SMART);
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
