import { expect, test } from "bun:test";
import { TRASH_RETENTION_MS } from "@teak/convex/shared/constants";
import { renderToStaticMarkup } from "react-dom/server";
import {
  TRASH_RETENTION_DAYS,
  TrashRetentionNote,
} from "../TrashRetentionNote";

test("Trash says how long cards stay, from the cleanup's own retention", () => {
  expect(TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000).toBe(TRASH_RETENTION_MS);
  expect(renderToStaticMarkup(<TrashRetentionNote />)).toContain(
    `Cards in Trash are deleted forever after ${TRASH_RETENTION_DAYS} days.`
  );
});
