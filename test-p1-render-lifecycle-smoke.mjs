import assert from "node:assert/strict";
import {
  BROWSER_PROVIDER_STATUS,
} from "./browser-provider.mjs";
import {
  DynamicRenderer,
} from "./dynamic-renderer.mjs";

const renderer = new DynamicRenderer({
  enabled: true,
  browser: "auto",
});

let lifecycleResult;
try {
  lifecycleResult = await renderer.withPage(({ browser, context, page }) => {
    assert.ok(browser.browserInstance, "Smoke result should expose a Browser instance.");
    assert.ok(context, "Smoke should create a BrowserContext.");
    assert.ok(page, "Smoke should create a Page.");
    return {
      browser: browser.browser,
      browserChannel: browser.browserChannel,
      browserVersion: browser.browserVersion,
      contextCreated: true,
      pageCreated: true,
    };
  });
} finally {
  await renderer.close();
}

if (!lifecycleResult.ok) {
  assert(
    [
      BROWSER_PROVIDER_STATUS.NOT_FOUND,
      BROWSER_PROVIDER_STATUS.LAUNCH_FAILED,
    ].includes(lifecycleResult.status),
    `Unexpected lifecycle smoke status: ${lifecycleResult.status}`,
  );
  console.log(`P1-02 lifecycle smoke ENV_BLOCKED: ${lifecycleResult.status}`);
} else {
  assert.equal(lifecycleResult.value.contextCreated, true);
  assert.equal(lifecycleResult.value.pageCreated, true);
  console.log(
    `P1-02 lifecycle smoke passed: ${lifecycleResult.value.browserChannel} ${lifecycleResult.value.browserVersion || ""}`.trim(),
  );
}
