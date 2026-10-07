import { expect, test } from "@playwright/test";
import { generateApiKey } from "../helpers/prod";

for (const firstClick of ["closes", "no-op"] as const) {
  test(`API key creation recovers when the first Security tab click ${firstClick}`, async ({
    page,
  }) => {
    // Every request is intercepted: this exercises the real browser helper,
    // without contacting production or creating an account or key there.
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

test("API key creation reloads a settings page that never renders its rows", async ({
  page,
}) => {
  // A mid-navigation deploy can leave /settings without any of its rows; the
  // helper gets exactly one reload to land on a healthy page.
  let loads = 0;
  await page.route("**/*", async (route) => {
    if (new URL(route.request().url()).pathname !== "/settings") {
      await route.abort();
      return;
    }
    loads += 1;
    if (loads === 1) {
      await route.fulfill({
        contentType: "text/html",
        body: `<html><body>Application error: a client-side exception has occurred</body></html>`,
      });
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
            clicks++;
            keys.setAttribute('aria-selected','true');panel.hidden=false;
          }
        </script>`,
    });
  });
  expect(await generateApiKey(page)).toBe("teakapi_fixture");
  expect(loads).toBe(2);
  expect(await page.evaluate("({ opens, clicks, creates })")).toEqual({
    opens: 1,
    clicks: 1,
    creates: 1,
  });
});
