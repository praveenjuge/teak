import { expect, test } from "bun:test";
import {
  renderSharedConstants,
  SHARED_CONSTANTS_PATH,
} from "../scripts/shared-constants";

test("the Apple app's shared constants match packages/convex/shared", async () => {
  const committed = await Bun.file(SHARED_CONSTANTS_PATH).text();
  expect(committed).toBe(renderSharedConstants());
});
