import { describe, expect, test } from "bun:test";
import {
  DELETED_BY_OTHER_STEPS,
  KEPT_TABLES,
  SWEPT_TABLES,
} from "../../accountDeletion/tables";
import schema from "../../schema";

// A table that holds a Teak user's rows must say what account deletion does
// with them; a new one missing from every list is left behind when the
// account goes.

const USER_KEYS = new Set([
  "actorTeakUserId",
  "targetTeakUserId",
  "teakUserId",
  "userId",
  "workosUserId",
]);

interface TableDefinition {
  indexes: { indexDescriptor: string; fields: string[] }[];
  validator: {
    fields?: Record<string, unknown>;
    kind: string;
    members?: { fields?: Record<string, unknown> }[];
  };
}

const tables = Object.entries(
  (schema as unknown as { tables: Record<string, TableDefinition> }).tables
);

const fieldsOf = ({ validator }: TableDefinition) =>
  validator.kind === "union"
    ? (validator.members ?? []).flatMap((member) =>
        Object.keys(member.fields ?? {})
      )
    : Object.keys(validator.fields ?? {});

const userTables = tables
  .filter(([, table]) => fieldsOf(table).some((field) => USER_KEYS.has(field)))
  .map(([name]) => name)
  .sort();

const listings = [
  ...SWEPT_TABLES.map(({ table }) => table),
  ...Object.keys(DELETED_BY_OTHER_STEPS),
  ...Object.keys(KEPT_TABLES),
];

describe("account deletion's table lists", () => {
  test("list every table with a user key exactly once", () => {
    expect([...listings].sort()).toEqual(userTables);
  });

  test.each(SWEPT_TABLES.map((swept) => [swept.table, swept] as const))(
    "%s is swept by an index that starts with its user key",
    (_, swept) => {
      const table = Object.fromEntries(tables)[swept.table];
      const index = table?.indexes.find(
        ({ indexDescriptor }) => indexDescriptor === swept.index
      );
      expect(index?.fields[0]).toBe(swept.key);
    }
  );
});
