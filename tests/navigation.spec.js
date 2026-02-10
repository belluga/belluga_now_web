const { test, expect } = require('@playwright/test');

test('web artifact boots and performs basic navigation', async ({ page }) => {
  const localBase = 'http://127.0.0.1:4173';
  const criticalAssetPattern = /\/(main\.dart\.js|flutter\.js|flutter_bootstrap\.js)(\?|$)/;
  const pageErrors = [];
  const failedCriticalRequests = [];
  const badCriticalResponses = [];

  // The built artifact runs a pre-Flutter branding fetch against the landlord host.
  // CI must not rely on external network and must remain deterministic.
  await page.route('**/api/v1/environment*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(localBase)) {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ name: 'CI', theme_data_settings: { primary_seed_color: '#4fa0e3' } })
    });
  });

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  page.on('requestfailed', (request) => {
    const url = request.url();
    const isCriticalLocalAsset = url.startsWith(localBase) && criticalAssetPattern.test(url);

    if (isCriticalLocalAsset) {
      failedCriticalRequests.push(`${request.method()} ${url} (${request.failure()?.errorText || 'unknown'})`);
    }
  });

  page.on('response', (response) => {
    const url = response.url();
    const isCriticalLocalAsset = url.startsWith(localBase) && criticalAssetPattern.test(url);

    if (isCriticalLocalAsset && response.status() >= 400) {
      badCriticalResponses.push(`${response.status()} ${response.request().method()} ${url}`);
    }
  });

  const homeResponse = await page.goto('/', { waitUntil: 'domcontentloaded' });
  expect(homeResponse, 'Home response should be available').not.toBeNull();
  expect(homeResponse.status(), 'Home response should be successful').toBeLessThan(400);
  await expect(page.locator('body')).toBeVisible();
  await expect(page.locator('script[src*="main.dart.js"]')).toHaveCount(1);

  // Flutter boots by attaching its root elements (avoid depending on app-specific UI copy).
  await expect(page.locator('flt-glass-pane')).toHaveCount(1, { timeout: 60000 });

  // Splash must be removed once Flutter paints the first frame.
  await expect(page.locator('#splash-screen')).toHaveCount(0, { timeout: 60000 });

  // After boot, the app should resolve its landing route (home/invites/landlord).
  // Accept both PathUrlStrategy and HashUrlStrategy.
  const landingRouteReady = async () => {
    const { pathname, hash } = window.location;
    const pathOk = pathname.startsWith('/home') || pathname.startsWith('/invites') || pathname.startsWith('/landlord');
    const hashOk = hash.startsWith('#/home') || hash.startsWith('#/invites') || hash.startsWith('#/landlord');
    return pathOk || hashOk;
  };
  await page.waitForFunction(landingRouteReady, null, { timeout: 60000 });

  await page.waitForTimeout(500);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible();
  await expect(page.locator('flt-glass-pane')).toHaveCount(1, { timeout: 60000 });
  await expect(page.locator('#splash-screen')).toHaveCount(0, { timeout: 60000 });

  // Useful debug signal in CI to understand which landing route the app chose.
  // (Shown in Playwright logs without making the test depend on UI strings.)
  const landingHref = await page.evaluate(() => window.location.href);
  console.log(`[nav] landing href: ${landingHref}`);

  expect(pageErrors, `Unexpected runtime errors:\n${pageErrors.join('\n')}`).toEqual([]);
  expect(failedCriticalRequests, `Critical asset request failures:\n${failedCriticalRequests.join('\n')}`).toEqual([]);
  expect(badCriticalResponses, `Critical asset bad responses:\n${badCriticalResponses.join('\n')}`).toEqual([]);
});

test('deep link serves app shell without 4xx/5xx', async ({ page }) => {
  // Ensure the server behaves like production nginx `try_files ... /index.html`.
  const routeResponse = await page.goto('/landlord', { waitUntil: 'domcontentloaded' });
  expect(routeResponse, 'Route response should be available').not.toBeNull();
  expect(routeResponse.status(), 'Deep link response should be successful').toBeLessThan(400);
  await expect(page.locator('body')).toBeVisible();
  await expect(page.locator('flt-glass-pane')).toHaveCount(1, { timeout: 60000 });
  await expect(page.locator('#splash-screen')).toHaveCount(0, { timeout: 60000 });
});
