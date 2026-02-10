const { test, expect } = require('@playwright/test');

test('web artifact boots and performs basic navigation', async ({ page }) => {
  const localBase = 'http://127.0.0.1:4173';
  const criticalAssetPattern = /\/(main\.dart\.js|flutter\.js|flutter_bootstrap\.js)(\?|$)/;
  const pageErrors = [];
  const failedCriticalRequests = [];
  const badCriticalResponses = [];

  // Guardrail: the published web bundle must never contain legacy hardcoded fallbacks
  // (e.g. boilerplate.belluga.space). These are unacceptable because they silently route
  // users to the wrong backend when environment/bootstrap fails.
  const jsResponse = await page.request.get(`${localBase}/main.dart.js`);
  expect(jsResponse.ok(), 'main.dart.js must be fetchable from the local web server').toBeTruthy();
  const jsText = await jsResponse.text();
  expect(
    jsText.includes('boilerplate.belluga.space'),
    'main.dart.js must not contain boilerplate.belluga.space fallback'
  ).toBeFalsy();

  // The web bootstrap depends on `/api/v1/environment` (host/origin), and the app
  // issues an anonymous identity during startup. In CI we serve only static files,
  // so these endpoints must be mocked to keep navigation validation deterministic.
  const mockEnvironmentPayload = {
    type: 'landlord',
    name: 'CI',
    main_domain: localBase,
    theme_data_settings: { primary_seed_color: '#4fa0e3' }
  };

  await page.route('**/api/v1/environment*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockEnvironmentPayload)
    });
  });

  // Matches BackendContext.fromAppData(): origin.resolve('/api') + '/v1/...'
  await page.route('**/api/v1/anonymous/identities*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          token: 'ci-anon-token',
          user_id: 'ci-user'
        }
      })
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
