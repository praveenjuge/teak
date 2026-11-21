// Every tab title reads "<page> · Teak"; pages without one read "Teak".
export const pageTitle = (title?: string): string =>
  title ? `${title} · Teak` : "Teak";

export const titleHead = (title?: string) => () => ({
  meta: [{ title: pageTitle(title) }],
});
