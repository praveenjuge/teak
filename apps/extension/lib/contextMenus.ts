import type { ContextMenuAction } from "../types/contextMenu";
import type { BackgroundStrings } from "./locale";

type MenuContext = `${chrome.contextMenus.ContextType}`;

const MENUS: {
  contexts: [MenuContext, ...MenuContext[]];
  id: ContextMenuAction;
  title: "saveAsset" | "savePage" | "saveText";
}[] = [
  { id: "save-page", title: "savePage", contexts: ["page"] },
  {
    id: "save-asset",
    title: "saveAsset",
    contexts: ["image", "video", "audio", "link"],
  },
  { id: "save-text", title: "saveText", contexts: ["selection"] },
];

const removeAllMenus = () =>
  new Promise<void>((resolve) => chrome.contextMenus.removeAll(resolve));

/**
 * Builds Teak's context menus in the given language. Each build waits for
 * the one before it, so two quick rebuilds never create an item twice.
 */
export function createContextMenuBuilder() {
  let queue = Promise.resolve();
  return (strings: BackgroundStrings): Promise<void> => {
    queue = queue
      .then(async () => {
        await removeAllMenus();
        for (const menu of MENUS) {
          chrome.contextMenus.create({
            id: menu.id,
            title: strings.contextMenu(menu.title),
            contexts: menu.contexts,
          });
        }
      })
      .catch(() => undefined);
    return queue;
  };
}
