import { EditorSelection } from "@codemirror/state";
import { type EditorView, WidgetType } from "@codemirror/view";

export interface MarkdownLinkSource {
  destinationFrom: number;
  destinationTo: number;
  from: number;
  href: string;
  label: string;
  to: number;
}

export function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function parseMarkdownLink(
  source: string,
  from = 0
): MarkdownLinkSource | null {
  const match = /^\[([\s\S]*?)\]\((\S+?)(?:\s+["'][^"']*["'])?\)$/u.exec(
    source
  );
  if (!(match?.[1] && match[2])) {
    return null;
  }
  const destinationOffset = source.indexOf(match[2], match[1].length + 3);
  return {
    destinationFrom: from + destinationOffset,
    destinationTo: from + destinationOffset + match[2].length,
    from,
    href: match[2],
    label: match[1].replace(/\\([\\\]])/gu, "$1"),
    to: from + source.length,
  };
}

export function editLinkDestination(
  view: EditorView,
  link: MarkdownLinkSource
) {
  view.dispatch({
    scrollIntoView: true,
    selection: EditorSelection.range(link.destinationFrom, link.destinationTo),
  });
  view.focus();
}

export async function copyLinkUrl(
  href: string,
  writeText: (value: string) => Promise<void> = (value) =>
    navigator.clipboard.writeText(value)
) {
  try {
    await writeText(href);
    return true;
  } catch {
    return false;
  }
}

export class MarkdownLinkWidget extends WidgetType {
  readonly destinationFrom: number;
  readonly destinationTo: number;
  readonly from: number;
  readonly href: string;
  readonly label: string;
  readonly to: number;
  private outsidePointerAbort?: AbortController;

  constructor(link: MarkdownLinkSource) {
    super();
    this.destinationFrom = link.destinationFrom;
    this.destinationTo = link.destinationTo;
    this.from = link.from;
    this.href = link.href;
    this.label = link.label;
    this.to = link.to;
  }

  eq(other: MarkdownLinkWidget) {
    return (
      other.from === this.from &&
      other.label === this.label &&
      other.href === this.href &&
      other.destinationFrom === this.destinationFrom &&
      other.destinationTo === this.destinationTo &&
      other.to === this.to
    );
  }

  toDOM(view: EditorView) {
    const shell = document.createElement("span");
    shell.className = "cm-md-link-shell";
    const trigger = document.createElement("button");
    trigger.className = "cm-md-link";
    trigger.type = "button";
    trigger.textContent = this.label;
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.title = "Link actions";
    const popover = document.createElement("span");
    popover.className = "cm-md-link-popover";
    popover.hidden = true;
    popover.setAttribute("aria-label", "Link actions");
    popover.setAttribute("role", "dialog");

    const close = (restoreFocus = false) => {
      this.outsidePointerAbort?.abort();
      this.outsidePointerAbort = undefined;
      popover.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      if (restoreFocus) {
        trigger.focus();
      }
    };
    const openDirectly = () => {
      window.open(this.href, "_blank", "noopener,noreferrer");
    };
    const addAction = (
      label: string,
      action: (button: HTMLButtonElement) => void | Promise<void>
    ) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", () => {
        void action(button);
      });
      popover.append(button);
      return button;
    };
    const openButton = addAction("Open", () => {
      openDirectly();
      close();
    });
    addAction("Copy URL", async (button) => {
      const copied = await copyLinkUrl(this.href);
      button.textContent = copied ? "Copied" : "Copy failed";
      window.setTimeout(() => {
        button.textContent = "Copy URL";
      }, 1400);
    });
    addAction("Edit", () => {
      close();
      editLinkDestination(view, this);
    });

    const toggle = () => {
      popover.hidden = !popover.hidden;
      trigger.setAttribute("aria-expanded", String(!popover.hidden));
      if (!popover.hidden) {
        this.outsidePointerAbort?.abort();
        this.outsidePointerAbort = new AbortController();
        document.addEventListener(
          "pointerdown",
          (event) => {
            if (event.target instanceof Node && !shell.contains(event.target)) {
              close();
            }
          },
          { capture: true, signal: this.outsidePointerAbort.signal }
        );
        openButton.focus();
      }
    };
    trigger.addEventListener("mousedown", (event) => {
      event.preventDefault();
      if (event.metaKey || event.ctrlKey) {
        openDirectly();
      }
    });
    trigger.addEventListener("click", (event) => {
      if (!(event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        toggle();
      }
    });
    shell.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !popover.hidden) {
        event.preventDefault();
        close(true);
      }
    });
    shell.append(trigger, popover);
    return shell;
  }

  destroy() {
    this.outsidePointerAbort?.abort();
  }

  ignoreEvent() {
    return true;
  }
}
