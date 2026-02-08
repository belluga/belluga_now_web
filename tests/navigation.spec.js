const { test, expect } = require('@playwright/test');

test('web artifact boots and performs basic navigation', async ({ page }) => {
  const localBase = 'http://127.0.0.1:4173';
  const criticalAssetPattern = /\/(main\.dart\.js|flutter\.js|flutter_bootstrap\.js)(\?|$)/;
  const pageErrors = [];
  const failedCriticalRequests = [];
  const badCriticalResponses = [];

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

  await page.evaluate(() => {
    window.location.hash = '#/ci-navigation-smoke';
  });
  await expect(page).toHaveURL(/#\/ci-navigation-smoke$/);

  await page.waitForTimeout(1000);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible();
  await expect(page).toHaveURL(/#\/ci-navigation-smoke$/);

  expect(pageErrors, `Unexpected runtime errors:\n${pageErrors.join('\n')}`).toEqual([]);
  expect(failedCriticalRequests, `Critical asset request failures:\n${failedCriticalRequests.join('\n')}`).toEqual([]);
  expect(badCriticalResponses, `Critical asset bad responses:\n${badCriticalResponses.join('\n')}`).toEqual([]);
});

test('hash route serves app shell without 4xx/5xx', async ({ page }) => {
  const routeResponse = await page.goto('/#/ci-navigation-smoke', { waitUntil: 'domcontentloaded' });
  expect(routeResponse, 'Route response should be available').not.toBeNull();
  expect(routeResponse.status(), 'Hash route response should be successful').toBeLessThan(400);
  await expect(page.locator('body')).toBeVisible();
  await expect(page).toHaveURL(/#\/ci-navigation-smoke$/);
});
