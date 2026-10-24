import { SESSION_HINT_COOKIE } from "@teak/convex/shared/sessionHint";

// The header renders Login and Register for signed-out visitors and "Open
// Teak" for signed-in ones, and leans on a script and a CSS rule to show only
// one set. A page that ships the links without both shows all three, so the
// build checks every page (scripts/check-header-visibility.ts).

const SIGNED_IN_ONLY = "data-signed-in-only";
const SIGNED_OUT_ONLY = "data-signed-out-only";

const hidesWith = (css: string, attribute: string): boolean =>
  [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)].some(
    ([, selector = "", body = ""]) =>
      selector.includes(attribute) && /display:\s*none/.test(body)
  );

/**
 * What a built page is missing to show exactly one set of header links:
 * the script that marks a signed-in visitor, which must run before the links
 * are parsed, and a rule hiding each set. `css` is every stylesheet the page
 * loads, inline or linked.
 */
export function headerVisibilityProblems(html: string, css: string): string[] {
  // The first element carrying either attribute; a <style> naming them
  // earlier in the page doesn't count.
  const firstLink = /<[a-z][^>]*\sdata-signed-(?:in|out)-only/.exec(
    html
  )?.index;
  if (firstLink === undefined) {
    return [];
  }
  const problems: string[] = [];
  const script = html.indexOf(`${SESSION_HINT_COOKIE}=1`);
  if (script < 0 || script > firstLink) {
    problems.push(
      "no session hint script before the header links (appEntryScript)"
    );
  }
  for (const attribute of [SIGNED_IN_ONLY, SIGNED_OUT_ONLY]) {
    if (!hidesWith(css, attribute)) {
      problems.push(`no CSS rule hides [${attribute}]`);
    }
  }
  return problems;
}
