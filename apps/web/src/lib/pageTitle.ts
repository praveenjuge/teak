import {
  createTeakTranslator,
  englishMessages,
  type Messages,
  type PartialMessages,
  type TeakTranslator,
  type UiLocale,
  withEnglishFallback,
} from "@teak/i18n";

// Every tab title reads "<page> · Teak"; pages without one read "Teak".
export const pageTitle = (title?: string): string =>
  title ? `${title} · Teak` : "Teak";

interface HeadMatch {
  loaderData?: unknown;
}

const filled = new WeakMap<PartialMessages, Messages>();

// The language the signed-in layout's loader chose, or English before it.
function headTranslator(matches: readonly HeadMatch[]): TeakTranslator {
  for (const { loaderData } of matches) {
    const session = loaderData as
      | { locale?: UiLocale; messages?: PartialMessages }
      | undefined;
    if (session?.locale && session.messages) {
      let messages = filled.get(session.messages);
      if (!messages) {
        messages = withEnglishFallback(session.messages);
        filled.set(session.messages, messages);
      }
      return createTeakTranslator(session.locale, messages);
    }
  }
  return createTeakTranslator("en", englishMessages);
}

/**
 * A route's `head` naming the tab in the person's language. The router
 * writes it before the route announcer reads `document.title`, and again
 * when a language change reloads the layout.
 */
export const titleHead =
  (title?: (t: TeakTranslator) => string) =>
  ({ matches }: { matches: readonly HeadMatch[] }) => ({
    meta: [{ title: pageTitle(title?.(headTranslator(matches))) }],
  });
