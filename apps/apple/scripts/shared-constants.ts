/**
 * Regenerate after changing a value in scripts/repo/native-constants.ts or the
 * `packages/convex/shared` code it reads:
 *   bun --no-env-file run apps/apple/scripts/shared-constants.ts --write
 */
import { resolve } from "node:path";
import { buildNativeConstants } from "../../../scripts/repo/native-constants";

export const SHARED_CONSTANTS_PATH = resolve(
  import.meta.dir,
  "../Packages/TeakKit/Sources/TeakCore/Resources/SharedConstants.json"
);

export const renderSharedConstants = () =>
  `${JSON.stringify(buildNativeConstants(), null, 2)}\n`;

if (import.meta.main) {
  if (process.argv.includes("--write")) {
    await Bun.write(SHARED_CONSTANTS_PATH, renderSharedConstants());
    console.log(`Wrote ${SHARED_CONSTANTS_PATH}`);
  } else {
    process.stdout.write(renderSharedConstants());
  }
}
