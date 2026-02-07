const { test, expect } = require('@playwright/test');

test('web artifact boots and performs basic navigation', async ({ page }) => {
  const pageErrors = [];
  const consoleErrors = [];
  const failedLocalRequests = [];
  const badLocalResponses = [];

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('requestfailed', (request) => {
    const url = request.url();
    const isLocalAsset = url.startsWith('http://127.0.0.1:4173');

    if (isLocalAsset) {
      failedLocalRequests.push(`${request.method()} ${url} (${request.failure()?.errorText || 'unknown'})`);
    }
  });

  page.on('response', (response) => {
    const url = response.url();
    const isLocalAsset = url.startsWith('http://127.0.0.1:4173');

    if (isLocalAsset && response.status() >= 400) {
      badLocalResponses.push(`${response.status()} ${response.request().method()} ${url}`);
    }
  });

  const homeResponse = await page.goto('/', { waitUntil: 'domcontentloaded' });
  expect(homeResponse, 'Home response should be available').not.toBeNull();
  expect(homeResponse.status(), 'Home response should be successful').toBeLessThan(400);
  await expect(page.locator('body')).toBeVisible();
  await expect(page.locator('script[src*="main.dart.js"]')).toHaveCount(1);

  const interactiveInViewportCount = await page.evaluate(() => {
    const selector = 'a, button, [role="button"]';
    const elements = Array.from(document.querySelectorAll(selector));

    return elements.filter((element) => {
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') {
        return false;
      }

      const rect = element.getBoundingClientRect();
      const hasArea = rect.width > 0 && rect.height > 0;
      const intersectsViewport =
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth;

      return hasArea && intersectsViewport;
    }).length;
  });
  expect(interactiveInViewportCount, 'At least one interactive element must be visible in viewport').toBeGreaterThan(0);

  await page.evaluate(() => {
    window.location.hash = '#/ci-navigation-smoke';
  });
  await expect(page).toHaveURL(/#\/ci-navigation-smoke$/);

  await page.waitForTimeout(1000);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible();
  await expect(page).toHaveURL(/#\/ci-navigation-smoke$/);

  expect(pageErrors, `Unexpected runtime errors:\n${pageErrors.join('\n')}`).toEqual([]);
  expect(consoleErrors, `Unexpected console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  expect(failedLocalRequests, `Local asset request failures:\n${failedLocalRequests.join('\n')}`).toEqual([]);
  expect(badLocalResponses, `Local asset bad responses:\n${badLocalResponses.join('\n')}`).toEqual([]);
});

test('hash route serves app shell without 4xx/5xx', async ({ page }) => {
  const routeResponse = await page.goto('/#/ci-navigation-smoke', { waitUntil: 'domcontentloaded' });
  expect(routeResponse, 'Route response should be available').not.toBeNull();
  expect(routeResponse.status(), 'Hash route response should be successful').toBeLessThan(400);
  await expect(page.locator('body')).toBeVisible();
  await expect(page).toHaveURL(/#\/ci-navigation-smoke$/);
});
