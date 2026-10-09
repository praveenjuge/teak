import {
  DEMO_CARD_TYPES,
  type DemoCard,
  type DemoCardType,
} from "../lib/home-demo-cards";

const badgeClass =
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full border bg-background px-3 py-1 text-sm font-medium whitespace-nowrap text-foreground hover:bg-accent dark:bg-input/30 [&_svg]:size-3.5";
const activeChipClass =
  "inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full bg-primary px-2.5 text-sm font-medium whitespace-nowrap text-primary-foreground transition-all hover:bg-primary/90 [&_svg]:size-3.5";

interface FilterState {
  favorites: boolean;
  keywords: string[];
  query: string;
  trash: boolean;
  types: DemoCardType[];
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
) => {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
};

export function mountHomeAppDemo(root: HTMLElement) {
  const $ = <T extends Element>(selector: string) =>
    root.querySelector<T>(selector) as T;

  const cards: Record<string, DemoCard> = JSON.parse(
    $<HTMLScriptElement>("[data-demo-cards]").textContent ?? "{}"
  );
  const grid = $<HTMLElement>("[data-demo-grid]");
  const noteItem = $<HTMLElement>("[data-demo-note-item]");
  const filters = $<HTMLElement>("[data-demo-filters]");
  const activeChips = $<HTMLElement>("[data-demo-active-chips]");
  const queryInput = $<HTMLInputElement>("[data-demo-query]");
  const clearChip = $<HTMLButtonElement>("[data-chip-clear]");
  const empty = $<HTMLElement>("[data-demo-empty]");
  const modal = $<HTMLElement>("[data-demo-modal]");

  const state: FilterState = {
    favorites: false,
    keywords: [],
    query: "",
    trash: false,
    types: [],
  };
  let searchFocused = false;
  let noteCount = 0;
  let openCardId: string | null = null;
  let returnFocus: HTMLElement | null = null;

  const icon = (key: string) => {
    const template = root.querySelector<HTMLTemplateElement>(
      `template[data-demo-icon="${key}"]`
    );
    return template
      ? template.content.cloneNode(true)
      : document.createTextNode("");
  };

  const cardButtons = () => [
    ...grid.querySelectorAll<HTMLButtonElement>("[data-card-id]"),
  ];

  const hasFilters = () =>
    state.favorites ||
    state.trash ||
    state.types.length > 0 ||
    state.keywords.length > 0;

  const matches = (button: HTMLButtonElement) => {
    const card = cards[button.dataset.cardId ?? ""];
    if (!card || state.trash) {
      return false;
    }
    if (state.types.length > 0 && !state.types.includes(card.type)) {
      return false;
    }
    if (state.favorites && !("favorite" in button.dataset)) {
      return false;
    }
    const tags = [...(card.tags ?? []), ...(card.aiTags ?? [])];
    if (!state.keywords.every((keyword) => tags.includes(keyword))) {
      return false;
    }
    const haystack = button.dataset.search ?? "";
    return state.query
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .every((word) => haystack.includes(word));
  };

  const addActiveChip = (
    iconKey: string | null,
    label: string,
    onClick: () => void
  ) => {
    const chip = el("button", activeChipClass);
    chip.type = "button";
    if (iconKey) {
      chip.append(icon(iconKey));
    }
    chip.append(el("span", undefined, label));
    // Keep the search input focused, like the app's preventBlur.
    chip.addEventListener("mousedown", (event) => event.preventDefault());
    chip.addEventListener("click", onClick);
    activeChips.append(chip);
  };

  const render = () => {
    const filtered = hasFilters() || state.query.trim().length > 0;

    activeChips.replaceChildren();
    for (const keyword of state.keywords) {
      addActiveChip("hash", keyword, () => {
        state.keywords = state.keywords.filter((item) => item !== keyword);
        render();
      });
    }
    for (const type of state.types) {
      addActiveChip(type, DEMO_CARD_TYPES[type].label, () => {
        state.types = state.types.filter((item) => item !== type);
        render();
      });
    }
    if (state.favorites) {
      addActiveChip("heart", "Favorites", () => {
        state.favorites = false;
        render();
      });
    }
    if (state.trash) {
      addActiveChip("trash", "Trash", () => {
        state.trash = false;
        render();
      });
    }

    for (const chip of root.querySelectorAll<HTMLButtonElement>(
      "[data-chip-type]"
    )) {
      chip.hidden = state.types.includes(chip.dataset.chipType as DemoCardType);
    }
    $<HTMLButtonElement>("[data-chip-favorites]").hidden = state.favorites;
    $<HTMLButtonElement>("[data-chip-trash]").hidden = state.trash;
    clearChip.hidden = !filtered;
    filters.hidden = !(searchFocused || filtered);

    let visibleCount = 0;
    for (const button of cardButtons()) {
      const visible = matches(button);
      (button.parentElement as HTMLElement).hidden = !visible;
      visibleCount += visible ? 1 : 0;
    }
    noteItem.hidden = state.trash;
    grid.toggleAttribute("data-filtered", filtered);
    grid.hidden = visibleCount === 0;
    empty.hidden = visibleCount > 0;
  };

  const clearAll = () => {
    state.favorites = false;
    state.keywords = [];
    state.query = "";
    state.trash = false;
    state.types = [];
    queryInput.value = "";
    render();
  };

  // Search
  const searchForm = $<HTMLFormElement>("[data-demo-search]");
  searchForm.addEventListener("submit", (event) => event.preventDefault());
  queryInput.addEventListener("input", () => {
    state.query = queryInput.value;
    render();
  });
  queryInput.addEventListener("focus", () => {
    searchFocused = true;
    render();
  });
  queryInput.addEventListener("blur", () => {
    searchFocused = false;
    render();
  });
  queryInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      clearAll();
      queryInput.blur();
    }
  });

  for (const chip of filters.querySelectorAll<HTMLButtonElement>("button")) {
    chip.addEventListener("mousedown", (event) => event.preventDefault());
  }
  for (const chip of root.querySelectorAll<HTMLButtonElement>(
    "[data-chip-type]"
  )) {
    chip.addEventListener("click", () => {
      state.types = [...state.types, chip.dataset.chipType as DemoCardType];
      render();
    });
  }
  $<HTMLButtonElement>("[data-chip-favorites]").addEventListener(
    "click",
    () => {
      state.favorites = true;
      render();
    }
  );
  $<HTMLButtonElement>("[data-chip-trash]").addEventListener("click", () => {
    state.trash = true;
    render();
  });
  clearChip.addEventListener("click", clearAll);
  $<HTMLButtonElement>("[data-demo-clear]").addEventListener("click", clearAll);

  // Quick note
  const noteForm = $<HTMLFormElement>("[data-demo-note]");
  const noteInput = $<HTMLTextAreaElement>("[data-demo-note-input]");
  const noteActions = $<HTMLElement>("[data-demo-note-actions]");
  const saveNote = () => {
    const content = noteInput.value.trim();
    if (!content) {
      return;
    }
    noteCount += 1;
    const id = `note-${noteCount}`;
    cards[id] = {
      id,
      type: "text",
      content,
      summary:
        "Your note, saved to the library. Teak adds a summary and tags in the background.",
      aiTags: ["note"],
    };

    const item = el("div", "demo-item");
    item.dataset.cardItem = id;
    const button = el("button", "demo-card");
    button.type = "button";
    button.dataset.cardId = id;
    button.dataset.type = "text";
    button.dataset.search = `${content} text note`.toLowerCase();
    button.setAttribute("aria-label", `Text: ${content}`);
    const heart = el(
      "span",
      "demo-heart absolute top-3 right-3 z-10 text-destructive"
    );
    heart.append(icon("heart"));
    const body = el("span", "block rounded-2xl border bg-card p-4");
    body.append(el("span", "line-clamp-2 font-medium", content));
    button.append(heart, body);
    item.append(button);
    noteItem.after(item);

    noteInput.value = "";
    noteActions.hidden = true;
    render();
  };
  noteInput.addEventListener("input", () => {
    noteActions.hidden = noteInput.value.trim().length === 0;
  });
  noteInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      saveNote();
    }
  });
  noteForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveNote();
  });

  // Card detail
  const modalTitle = $<HTMLElement>("[data-demo-modal-title]");
  const modalPreview = $<HTMLElement>("[data-demo-modal-preview]");
  const modalSummary = $<HTMLElement>("[data-demo-modal-summary]");
  const modalBadges = $<HTMLElement>("[data-demo-modal-badges]");
  const favoriteAction = $<HTMLButtonElement>("[data-demo-modal-favorite]");
  const linkAction = $<HTMLAnchorElement>("[data-demo-modal-link]");
  const closeButton = $<HTMLButtonElement>("[data-demo-close]");

  const cardButton = (id: string) =>
    grid.querySelector<HTMLButtonElement>(`[data-card-id="${id}"]`);

  const renderPreview = (card: DemoCard) => {
    modalPreview.replaceChildren();
    const image = card.image;

    if (
      (card.type === "image" ||
        card.type === "video" ||
        card.type === "document") &&
      image
    ) {
      // Fit the preview area like object-contain, keeping the rounded frame on the image.
      const frame = el("span", "relative block overflow-hidden rounded-2xl");
      frame.style.aspectRatio = `${image.width} / ${image.height}`;
      frame.style.width = `min(100cqw, 100cqh * ${image.width / image.height})`;
      const img = el("img", "h-full w-full object-cover");
      img.src = image.full ?? image.src;
      img.alt = card.content ?? card.title ?? "";
      frame.append(img);
      if (card.type === "video") {
        const overlay = el(
          "span",
          "absolute inset-0 flex items-center justify-center bg-black/20"
        );
        const circle = el(
          "span",
          "rounded-full bg-black/50 p-3 text-white [&_svg]:size-8"
        );
        circle.append(icon("play"));
        overlay.append(circle);
        frame.append(overlay);
      }
      modalPreview.append(frame);
      return;
    }

    if (card.type === "link") {
      const wrap = el("span", "flex w-full max-w-xl flex-col gap-3");
      if (image) {
        const img = el("img", "w-full rounded-2xl border object-cover");
        img.src = image.src;
        img.alt = card.title ?? "";
        wrap.append(img);
      }
      wrap.append(el("span", "text-lg font-semibold text-balance", card.title));
      if (card.url) {
        wrap.append(
          el(
            "span",
            "truncate text-muted-foreground",
            new URL(card.url).hostname
          )
        );
      }
      modalPreview.append(wrap);
      return;
    }

    if (card.type === "palette") {
      const wrap = el(
        "span",
        "grid w-full max-w-xl grid-cols-5 overflow-hidden rounded-2xl border"
      );
      for (const hex of card.colors ?? []) {
        const swatch = el(
          "span",
          "flex h-48 items-end justify-center pb-3 text-xs font-medium"
        );
        swatch.style.backgroundColor = hex;
        const label = el(
          "span",
          "rounded-full bg-background/90 px-2 py-0.5 text-foreground",
          hex
        );
        swatch.append(label);
        wrap.append(swatch);
      }
      modalPreview.append(wrap);
      return;
    }

    if (card.type === "audio") {
      const wrap = el("span", "flex w-full max-w-xl flex-col gap-3");
      const player = el(
        "span",
        "flex h-16 items-center gap-3 rounded-full border bg-card px-4"
      );
      const play = el(
        "span",
        "flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground [&_svg]:size-4"
      );
      play.append(icon("play"));
      const bars = el("span", "flex h-8 flex-1 items-center justify-between");
      const source = cardButton(card.id)?.querySelectorAll<HTMLElement>(
        "[style*='height']"
      );
      for (const bar of source ?? []) {
        bars.append(bar.cloneNode(true));
      }
      player.append(
        play,
        bars,
        el("span", "text-xs text-muted-foreground tabular-nums", "1:24")
      );
      wrap.append(player, el("span", "px-1 text-muted-foreground", card.title));
      modalPreview.append(wrap);
      return;
    }

    const text = el(
      "span",
      card.type === "quote"
        ? "max-w-xl text-center text-2xl leading-relaxed font-medium text-balance italic"
        : "max-w-xl text-base leading-relaxed whitespace-pre-wrap",
      card.content
    );
    modalPreview.append(text);
  };

  const renderFavorite = (id: string) => {
    const isFavorite = "favorite" in (cardButton(id)?.dataset ?? {});
    const label = favoriteAction.querySelector("span");
    if (label) {
      label.textContent = isFavorite ? "Unfavorite" : "Favorite";
    }
    favoriteAction
      .querySelector("svg")
      ?.classList.toggle("demo-filled", isFavorite);
  };

  const addBadge = (content: Node[], onClick?: () => void, title?: string) => {
    const badge = el("button", badgeClass);
    badge.type = "button";
    if (title) {
      badge.title = title;
      badge.setAttribute("aria-label", title);
    }
    badge.append(...content);
    if (onClick) {
      badge.addEventListener("click", onClick);
    }
    modalBadges.append(badge);
  };

  const closeModal = () => {
    modal.hidden = true;
    openCardId = null;
    returnFocus?.focus({ preventScroll: true });
  };

  const filterFromModal = (apply: () => void) => {
    apply();
    closeModal();
    render();
  };

  const openModal = (id: string, trigger: HTMLElement) => {
    const card = cards[id];
    if (!card) {
      return;
    }
    openCardId = id;
    returnFocus = trigger;
    modalTitle.textContent =
      card.title ?? card.content ?? DEMO_CARD_TYPES[card.type].label;
    modalSummary.textContent = card.summary ?? "";
    renderPreview(card);

    modalBadges.replaceChildren();
    addBadge(
      [
        icon(card.type),
        el("span", undefined, DEMO_CARD_TYPES[card.type].label),
      ],
      () =>
        filterFromModal(() => {
          if (!state.types.includes(card.type)) {
            state.types = [...state.types, card.type];
          }
        })
    );
    for (const tag of card.tags ?? []) {
      addBadge([el("span", undefined, tag)], () =>
        filterFromModal(() => {
          if (!state.keywords.includes(tag)) {
            state.keywords = [...state.keywords, tag];
          }
        })
      );
    }
    if (card.type !== "palette") {
      for (const hex of card.colors ?? []) {
        const dot = el("span", "size-3.5 rounded-full border border-black/10");
        dot.style.backgroundColor = hex;
        addBadge([dot], undefined, hex);
        modalBadges.lastElementChild?.classList.replace("px-3", "px-2");
      }
    }
    for (const tag of card.aiTags ?? []) {
      addBadge([icon("sparkles"), el("span", undefined, tag)], () =>
        filterFromModal(() => {
          if (!state.keywords.includes(tag)) {
            state.keywords = [...state.keywords, tag];
          }
        })
      );
    }

    renderFavorite(id);
    linkAction.hidden = !card.url;
    if (card.url) {
      linkAction.href = card.url;
    }
    modal.hidden = false;
    closeButton.focus({ preventScroll: true });
  };

  grid.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-card-id]"
    );
    if (button?.dataset.cardId) {
      openModal(button.dataset.cardId, button);
    }
  });
  favoriteAction.addEventListener("click", () => {
    const button = openCardId ? cardButton(openCardId) : null;
    if (!(button && openCardId)) {
      return;
    }
    button.toggleAttribute("data-favorite");
    renderFavorite(openCardId);
    render();
  });
  closeButton.addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });
  modal.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeModal();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    // Keep focus inside the open card, like the app's dialog.
    const focusable = [
      ...modal.querySelectorAll<HTMLElement>("button, a[href]"),
    ].filter((node) => !node.hidden && node.offsetParent !== null);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  });

  render();
}
