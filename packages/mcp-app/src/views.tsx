import { useState } from "react";
import { type AppMessages, type AppTranslator, cardTypeLabel } from "./i18n";
import type { CardView, ListSource, TeakCard } from "./model";

export interface ViewProps {
  messages: AppMessages;
  onOpen: (url: string) => void;
  t: AppTranslator;
}

const MAX_EXCERPT = 280;
const MARKDOWN_PREFIX = /^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?)/u;

/** Cards whose own text is their preview, so they show no separate title. */
const isTextCard = (card: TeakCard) =>
  card.type === "text" || card.type === "quote";

/**
 * A note or quote's text without Markdown line marks, cut to a preview; with
 * `withoutTitle`, minus the first line the card is titled by.
 */
const excerpt = (card: TeakCard, withoutTitle = false): string | null => {
  if (!isTextCard(card)) {
    return null;
  }
  const lines = card.content
    .split("\n")
    .map((line) => line.replace(MARKDOWN_PREFIX, "").trimEnd());
  const first = lines.findIndex((line) => line.trim());
  if (withoutTitle && first >= 0 && lines[first]?.trim() === card.title) {
    lines.splice(first, 1);
  }
  const body = lines.join("\n").trim();
  if (!body) {
    return null;
  }
  return body.length > MAX_EXCERPT ? `${body.slice(0, MAX_EXCERPT)}…` : body;
};

const Swatches = ({ card }: { card: TeakCard }) =>
  card.colors.length > 0 ? (
    <div className="swatches">
      {card.colors.slice(0, 8).map((color) => (
        <span
          className="swatch"
          key={color.hex}
          style={{ backgroundColor: color.hex }}
          title={color.name ?? color.hex}
        />
      ))}
    </div>
  ) : null;

/** A card's image; a URL the sandbox refuses falls back to the text preview. */
const CardImage = ({
  card,
  className,
}: {
  card: TeakCard;
  className: string;
}) => {
  const [failed, setFailed] = useState(false);
  if (!card.imageUrl || failed) {
    return null;
  }
  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: a failed load falls back to the text preview; the image isn't interactive
    // biome-ignore lint/correctness/useImageSize: card media of unknown size, sized by CSS
    <img
      alt={card.title ?? ""}
      className={className}
      decoding="async"
      onError={() => setFailed(true)}
      referrerPolicy="no-referrer"
      src={card.imageUrl}
    />
  );
};

const Preview = ({ card }: { card: TeakCard }) => {
  const text = excerpt(card);
  if (card.type === "palette" && card.colors.length > 0) {
    return (
      <div className="palette">
        {card.colors.slice(0, 8).map((color) => (
          <span key={color.hex} style={{ backgroundColor: color.hex }} />
        ))}
      </div>
    );
  }
  if (text) {
    return (
      <p className={card.type === "quote" ? "excerpt quote" : "excerpt"}>
        {text}
      </p>
    );
  }
  return null;
};

const Meta = ({
  card,
  messages,
}: {
  card: TeakCard;
  messages: AppMessages;
}) => (
  <p className="meta">{card.siteName ?? cardTypeLabel(messages, card.type)}</p>
);

const FavoriteMark = ({ card, t }: { card: TeakCard; t: AppTranslator }) =>
  card.isFavorited ? (
    <span aria-label={t("favorite")} className="favorite" role="img">
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M12 21s-7.5-4.6-9.5-9.2C1.2 8.6 3.3 5 6.8 5c2.1 0 3.6 1.2 4.4 2.5h1.6C13.6 6.2 15.1 5 17.2 5c3.5 0 5.6 3.6 4.3 6.8C19.5 16.4 12 21 12 21z" />
      </svg>
    </span>
  ) : null;

const CardTile = ({
  card,
  messages,
  onOpen,
  t,
}: ViewProps & { card: TeakCard }) => {
  const target = card.appUrl ?? card.url;
  const body = (
    <>
      <CardImage card={card} className="tile-image" />
      {card.imageUrl ? null : <Preview card={card} />}
      <div className="tile-text">
        {card.title && !(isTextCard(card) && excerpt(card)) ? (
          <p className="title">{card.title}</p>
        ) : null}
        <div className="row">
          <Meta card={card} messages={messages} />
          <FavoriteMark card={card} t={t} />
        </div>
      </div>
    </>
  );
  return target ? (
    <button
      className="tile"
      onClick={() => onOpen(target)}
      title={t("openInTeak")}
      type="button"
    >
      {body}
    </button>
  ) : (
    <div className="tile">{body}</div>
  );
};

const Actions = ({
  card,
  onOpen,
  t,
}: Pick<ViewProps, "onOpen" | "t"> & { card: TeakCard }) => (
  <div className="actions">
    {card.appUrl ? (
      <button
        className="button primary"
        onClick={() => card.appUrl && onOpen(card.appUrl)}
        type="button"
      >
        {t("openInTeak")}
      </button>
    ) : null}
    {card.url ? (
      <button
        className="button"
        onClick={() => card.url && onOpen(card.url)}
        type="button"
      >
        {t("visitSource")}
      </button>
    ) : null}
  </div>
);

const Tags = ({ card }: { card: TeakCard }) =>
  card.tags.length > 0 ? (
    <ul className="tags">
      {card.tags.slice(0, 12).map((tag) => (
        <li key={tag}>{`#${tag}`}</li>
      ))}
    </ul>
  ) : null;

const listTitle = (
  t: AppTranslator,
  source: ListSource,
  query: string | null
): string => {
  if (source === "favorites") {
    return t("favoritesTitle");
  }
  if (source === "recent") {
    return t("recentTitle");
  }
  return query ? t("searchTitle", { query }) : t("searchTitleNoQuery");
};

export const ListView = ({
  cards,
  query,
  source,
  ...props
}: ViewProps & {
  cards: TeakCard[];
  query: string | null;
  source: ListSource;
}) => (
  <section className="list">
    <header className="list-header">
      <h1>{listTitle(props.t, source, query)}</h1>
      <span className="count">
        {props.t("cardCount", { count: cards.length })}
      </span>
    </header>
    {cards.length === 0 ? (
      <p className="empty">{props.t("empty")}</p>
    ) : (
      <div className="grid">
        {cards.map((card) => (
          <CardTile card={card} key={card.id} {...props} />
        ))}
      </div>
    )}
  </section>
);

export const CardDetail = ({
  card,
  ...props
}: ViewProps & { card: TeakCard }) => {
  const isQuote = card.type === "quote";
  const text = excerpt(card, !isQuote);
  return (
    <article className="detail">
      <CardImage card={card} className="detail-image" />
      {card.type === "palette" ? <Preview card={card} /> : null}
      <div className="detail-body">
        <div className="row">
          <Meta card={card} messages={props.messages} />
          <FavoriteMark card={card} t={props.t} />
        </div>
        {card.title && !(isQuote && text) ? <h1>{card.title}</h1> : null}
        {text ? (
          <p className={isQuote ? "excerpt quote" : "excerpt"}>{text}</p>
        ) : null}
        {card.aiSummary ? (
          <section>
            <h2>{props.t("summary")}</h2>
            <p>{card.aiSummary}</p>
          </section>
        ) : null}
        {card.notes ? (
          <section>
            <h2>{props.t("notes")}</h2>
            <p>{card.notes}</p>
          </section>
        ) : null}
        {card.type === "palette" ? null : <Swatches card={card} />}
        <Tags card={card} />
        <Actions card={card} onOpen={props.onOpen} t={props.t} />
      </div>
    </article>
  );
};

export const SavedCard = ({
  card,
  resaved,
  ...props
}: ViewProps & { card: TeakCard; resaved: boolean }) => (
  <article className="saved">
    {card.imageUrl || card.colors.length > 0 ? (
      <div className="saved-thumb">
        <CardImage card={card} className="thumb-image" />
        {card.imageUrl ? null : <Swatches card={card} />}
      </div>
    ) : null}
    <div className="saved-body">
      <p className="status">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6 11.2-11.2-1.4-1.4z" />
        </svg>
        {resaved ? props.t("resavedTitle") : props.t("savedTitle")}
      </p>
      {card.title ? <p className="title">{card.title}</p> : null}
      <Meta card={card} messages={props.messages} />
      <Actions card={card} onOpen={props.onOpen} t={props.t} />
    </div>
  </article>
);

export const TeakView = ({
  view,
  ...props
}: ViewProps & { view: CardView }) => {
  switch (view.kind) {
    case "list":
      return (
        <ListView
          cards={view.cards}
          query={view.query}
          source={view.source}
          {...props}
        />
      );
    case "card":
      return <CardDetail card={view.card} {...props} />;
    case "saved":
      return <SavedCard card={view.card} resaved={view.resaved} {...props} />;
    case "error":
      return <p className="empty">{props.t("error")}</p>;
    default:
      return (
        <p aria-busy="true" className="empty">
          {props.t("loading")}
        </p>
      );
  }
};
