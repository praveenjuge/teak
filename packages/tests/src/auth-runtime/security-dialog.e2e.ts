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

const workingFixture = `<div><span>Security</span><button onclick="opens++;dialog.hidden=false">Manage</button></div>
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
  </script>`;

const routeSettings = async (
  page: Parameters<typeof generateApiKey>[0],
  fulfill: (
    route: import("@playwright/test").Route,
    load: number
  ) => Promise<void>
) => {
  let loads = 0;
  await page.route("**/*", async (route) => {
    if (new URL(route.request().url()).pathname !== "/settings") {
      await route.abort();
      return;
    }
    loads += 1;
    await fulfill(route, loads);
  });
  return () => loads;
};

test("API key creation reloads a settings page that never renders its rows", async ({
  page,
}) => {
  // A mid-navigation deploy can leave /settings without any of its rows; the
  // helper gets exactly one reload to land on a healthy page.
  const loads = await routeSettings(page, async (route, load) => {
    await route.fulfill({
      contentType: "text/html",
      body:
        load === 1
          ? "<html><body>Application error: a client-side exception has occurred</body></html>"
          : workingFixture,
    });
  });
  expect(await generateApiKey(page)).toBe("teakapi_fixture");
  expect(loads()).toBe(2);
  expect(await page.evaluate("({ opens, clicks, creates })")).toEqual({
    opens: 1,
    clicks: 1,
    creates: 1,
  });
});

test("API key creation does not reload a settings page that renders late", async ({
  page,
}) => {
  // A healthy page can render its rows after the load event; that alone must
  // not spend the single reload. The rows arrive client-side after load, not
  // in a delayed response, so the helper's bounded wait is what sees them.
  const fixtureMarkup = workingFixture.slice(
    0,
    workingFixture.indexOf("<script>")
  );
  const fixtureScript = workingFixture.slice(
    workingFixture.indexOf("<script>")
  );
  const loads = await routeSettings(page, async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: `<div id="root"></div>${fixtureScript}<script>window.addEventListener("load",()=>setTimeout(()=>{document.getElementById("root").outerHTML=${JSON.stringify(
        fixtureMarkup
      )};},3000));</script>`,
    });
  });
  expect(await generateApiKey(page)).toBe("teakapi_fixture");
  expect(loads()).toBe(1);
  expect(await page.evaluate("({ opens, clicks, creates })")).toEqual({
    opens: 1,
    clicks: 1,
    creates: 1,
  });
});
