import { updateState } from "./run-state";

const label = process.argv[2];
if (!(label && /^[ab]-$/.test(label))) {
  throw new Error("Writer label must be a supported test fixture prefix");
}

for (let index = 0; index < 40; index += 1) {
  updateState((state) => state.createdCardIds.push(`${label}${index}`));
}
