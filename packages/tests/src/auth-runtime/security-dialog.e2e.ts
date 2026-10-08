import { expect, test } from "@playwright/test";
import { generateApiKey } from "../helpers/app";

for (const firstClick of ["closes", "no-op"] as const) {
  test(`API key creation recovers when the first Security tab click ${firstClick}`, async ({
    page,
  }) => {
    // Every request is intercepted: this exercises the real browser helper,
    // without a backend or a real account.
    await page.route("**/*", async (route) => {
      if (new URL(route.request().url()).pathname !== "/settings") {
        await route.abort();
        return;
      }
      await route.fulfill({
        contentType: "text/html",
        body: `<div><span>Security</span><button onclick="opens++;dialog.hidden=false">Manage</button></div>
          <div id="dialog" role="dialog" aria-label="Security" hidden>
            <button role="tab" aria-selected="true">Connections</button>
            <button id="keys" role="tab" aria-selected="false" onclick="selectKeys()">API keys</button>
            <div id="panel" role="tabpanel" aria-label="API keys" hidden>
              <button onclick="creates++;document.querySelector('input').value='teakapi_fixture'">Create key</button>
              <input readonly value="">
            </div>
          </div>
          <script>
            let opens=0, clicks=0, creates=0;
            function selectKeys(){
              if(++clicks===1){${firstClick === "closes" ? "dialog.hidden=true;" : ""}return;}
              keys.setAttribute('aria-selected','true');panel.hidden=false;
            }
          </script>`,
      });
    });
    expect(await generateApiKey(page)).toBe("teakapi_fixture");
    expect(await page.evaluate("({ opens, clicks, creates })")).toEqual({
      opens: firstClick === "closes" ? 2 : 1,
      clicks: 2,
      creates: 1,
    });
  });
}
