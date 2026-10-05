import { expect, test } from "bun:test";
import { main } from "./import-users";

const pinned = [
  "--deployment",
  "isolated-rehearsal",
  "--environment-id",
  "environment_test",
  "--client-id",
  "client_test",
  "--witness-email",
  "witness@example.com",
  "--witness-external-id",
  "none",
  "--journal",
  "/tmp/teak-import-argument-test.json",
];
// Failure modes: implicit deployment; option injection; malformed pins; writes
// without recorded approval; conflicting dry-run/apply. All stop before IO.
test("requires explicit pins and rejects malformed or unknown options before reading credentials", async () => {
  await expect(main([])).rejects.toThrow("Required --deployment");
  await expect(main([...pinned, "--prod"])).rejects.toThrow(
    "Invalid importer arguments"
  );
  await expect(
    main([...pinned, "--client-id", "client_other"])
  ).rejects.toThrow("Invalid importer arguments");
  await expect(
    main(["--deployment", "../production", ...pinned.slice(2)])
  ).rejects.toThrow("Invalid explicit deployment pins");
});
test("actual writes require their own approval reference and cannot masquerade as dry-run", async () => {
  await expect(main([...pinned, "--apply"])).rejects.toThrow(
    "recorded separate approval"
  );
  await expect(
    main([
      ...pinned,
      "--apply",
      "--dry-run",
      "--approval-reference",
      "approved-run",
    ])
  ).rejects.toThrow("Choose dry-run or apply");
});
