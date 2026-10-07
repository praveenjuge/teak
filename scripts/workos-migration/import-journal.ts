import { readFile, rename, stat, writeFile } from "node:fs/promises";
export interface ImportPins {
  apiKeyFingerprint: string;
  clientId: string;
  deployment: string;
  environmentId: string;
  hashesProven: boolean;
  resetPasswords?: boolean;
  witnessEmail: string;
  witnessExternalId: string | null;
  witnessUserId: string;
}
export interface ImportJournal extends ImportPins {
  approvalReference: string | null;
  completed: boolean;
  cursor: string | null;
  mode: "initial" | "delta";
  startedAt: number;
  version: 1;
  watermark: number;
}
export async function readJournal(
  path: string,
  pins: ImportPins
): Promise<ImportJournal> {
  const metadata = await stat(path);
  if (metadata.mode % 0o100 !== 0) {
    throw new Error("Journal must be owner-only");
  }
  const journal: ImportJournal = JSON.parse(await readFile(path, "utf8"));
  if (
    journal?.version !== 1 ||
    !(journal.mode === "initial" || journal.mode === "delta") ||
    typeof journal.completed !== "boolean" ||
    !(journal.cursor === null || typeof journal.cursor === "string") ||
    !Number.isFinite(journal.watermark) ||
    !Number.isFinite(journal.startedAt) ||
    journal.watermark < 0 ||
    journal.watermark > journal.startedAt ||
    journal.startedAt > Date.now()
  ) {
    throw new Error("Invalid importer journal");
  }
  if ((journal.resetPasswords ?? false) !== (pins.resetPasswords ?? false)) {
    throw new Error("Importer journal password policy changed");
  }
  if (
    journal.resetPasswords !== undefined &&
    typeof journal.resetPasswords !== "boolean"
  ) {
    throw new Error("Invalid importer password policy");
  }
  for (const key of [
    "deployment",
    "environmentId",
    "clientId",
    "apiKeyFingerprint",
    "hashesProven",
    "witnessUserId",
    "witnessEmail",
    "witnessExternalId",
  ] as const) {
    if (journal[key] !== pins[key]) {
      throw new Error("Importer journal pins changed");
    }
  }
  return journal;
}
export function admission(
  pins: ImportPins,
  previous: ImportJournal | null,
  mode: "initial" | "delta" | "resume",
  approvalReference: string | null
): ImportJournal {
  if (mode === "resume") {
    if (!previous || previous.completed) {
      throw new Error("Resume requires an incomplete admitted run");
    }
    return previous;
  }
  if (mode === "delta" && !previous?.completed) {
    throw new Error("Finish or resume the previous import before delta");
  }
  if (mode === "initial" && previous) {
    throw new Error("Existing journal requires resume or delta");
  }
  return {
    ...pins,
    version: 1,
    mode,
    cursor: null,
    completed: false,
    watermark: previous?.watermark ?? 0,
    startedAt: Date.now(),
    approvalReference,
  };
}
export async function writeJournal(
  path: string,
  journal: ImportJournal,
  initial: boolean
) {
  const contents = JSON.stringify(journal, null, 2);
  if (initial) {
    await writeFile(path, contents, { flag: "wx", mode: 0o600 });
    return;
  }
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, contents, { flag: "wx", mode: 0o600 });
  await rename(temporary, path);
}
