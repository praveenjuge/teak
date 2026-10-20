import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { VAULT_SETUP_STEPS, VaultSetupState } from "../VaultSetupState";

test("tells a new account its vault is being set up, as a live status", () => {
  const html = renderToStaticMarkup(<VaultSetupState />);

  expect(html).toContain('role="status"');
  expect(html).toContain('aria-live="polite"');
  expect(html).toContain("Setting up your vault");
  expect(html).toContain(VAULT_SETUP_STEPS[0]);
});
