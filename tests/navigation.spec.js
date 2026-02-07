const { test, expect } = require('@playwright/test');

test('web artifact boots and performs basic navigation', async ({ page }) => {
  const pageErrors = [];
  const failedLocalRequests = [];

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  page.on('requestfailed', (request) => {
    const url = request.url();
    const isLocalAsset = url.startsWith('http://127.0.0.1:4173');

    if (isLocalAsset) {
      failedLocalRequests.push(`${request.method()} ${url} (${request.failure()?.errorText || 'unknown'})`);
    }
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible();

  const firstInteractive = page.locator('a:visible, button:visible, [role="button"]:visible').first();
  if (await firstInteractive.count()) {
    await firstInteractive.click({ timeout: 5000 }).catch(() => {});
  }

  await page.evaluate(() => {
    window.location.hash = '#/ci-navigation-smoke';
  });

  await page.waitForTimeout(1000);
  await page.reload({ waitUntil: 'domcontentloaded' });

  expect(pageErrors, `Unexpected runtime errors:\n${pageErrors.join('\n')}`).toEqual([]);
  expect(failedLocalRequests, `Local asset request failures:\n${failedLocalRequests.join('\n')}`).toEqual([]);
});
