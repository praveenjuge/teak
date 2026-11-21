import { Link } from "@tanstack/react-router";
import type { ComponentProps } from "react";

export type AppLinkProps = Omit<
  ComponentProps<typeof Link>,
  "href" | "to" | "search" | "hash" | "params"
> & {
  /** An app URL, such as `/?card=…` or `/settings/plan`. */
  href: string;
};

/**
 * A router link to an app URL built as a string. Teak builds its URLs once
 * (`@teak/convex/shared/webRoutes`) for every app, so links take them whole.
 */
export function AppLink({ href, ...props }: AppLinkProps) {
  // The router builds the destination from `href`; `to` only satisfies the
  // types and is ignored when `href` is set. The router marks an active link
  // `aria-current="page"`; only a link to this exact URL is the current page
  // (Settings in a sub-page's breadcrumb is not).
  return <Link activeOptions={{ exact: true }} href={href} to="." {...props} />;
}
