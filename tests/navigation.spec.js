const { test, expect } = require('@playwright/test');

const landlordUrl = process.env.NAV_LANDLORD_URL;
const tenantUrl = process.env.NAV_TENANT_URL;

if (!landlordUrl || !tenantUrl) {
  throw new Error('Missing NAV_LANDLORD_URL/NAV_TENANT_URL. Real navigation tests require live backend URLs.');
}

function installFailureCollectors(page) {
  const runtimeErrors = [];
  const failedRequests = [];
  const consoleErrors = [];

  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('requestfailed', (request) => {
    failedRequests.push(`${request.method()} ${request.url()} (${request.failure()?.errorText || 'unknown'})`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  return { runtimeErrors, failedRequests, consoleErrors };
}

async function assertAppBooted(page) {
  await expect(page.locator('body')).toBeVisible();
  await expect(page.locator('script[src*="main.dart.js"]')).toHaveCount(1);
  await expect(page.locator('flt-glass-pane')).toHaveCount(1, { timeout: 90000 });
  await expect(page.locator('#splash-screen')).toHaveCount(0, { timeout: 90000 });
}

async function waitForLanding(page, allowedPrefixes) {
  await page.waitForFunction(
    (prefixes) => {
      const { pathname, hash } = window.location;
      const pathOk = prefixes.some((prefix) => pathname.startsWith(prefix));
      const hashOk = prefixes.some((prefix) => hash.startsWith(`#${prefix}`));
      return pathOk || hashOk;
    },
    allowedPrefixes,
    { timeout: 90000 }
  );
}

async function logLandingHref(page, lane) {
  const landingHref = await page.evaluate(() => window.location.href);
  console.log(`[nav][${lane}] landing href: ${landingHref}`);
}

test('landlord domain bootstraps as landlord and navigates', async ({ page }) => {
  const collectors = installFailureCollectors(page);

  const envResponsePromise = page.waitForResponse((response) => {
    return response.url().includes('/api/v1/environment') && response.request().method() === 'GET';
  });

  const response = await page.goto(landlordUrl, { waitUntil: 'domcontentloaded' });
  expect(response, 'Landlord response should be available').not.toBeNull();
  expect(response.status(), 'Landlord response should be successful').toBeLessThan(400);

  const envResponse = await envResponsePromise;
  expect(envResponse.status(), 'Landlord environment endpoint should succeed').toBeLessThan(400);
  const envPayload = await envResponse.json();
  expect(envPayload?.type, 'Landlord environment payload must resolve as landlord').toBe('landlord');

  await assertAppBooted(page);
  await waitForLanding(page, ['/', '/landlord', '/home', '/invites', '/convites', '/profile']);
  await logLandingHref(page, 'landlord');

  expect(collectors.runtimeErrors, `Unexpected runtime errors:\n${collectors.runtimeErrors.join('\n')}`).toEqual([]);
  expect(collectors.failedRequests, `Failed requests:\n${collectors.failedRequests.join('\n')}`).toEqual([]);
});

test('tenant domain bootstraps as tenant and navigates to tenant routes', async ({ page }) => {
  const collectors = installFailureCollectors(page);

  const envResponsePromise = page.waitForResponse((response) => {
    return response.url().includes('/api/v1/environment') && response.request().method() === 'GET';
  });

  const response = await page.goto(tenantUrl, { waitUntil: 'domcontentloaded' });
  expect(response, 'Tenant response should be available').not.toBeNull();
  expect(response.status(), 'Tenant response should be successful').toBeLessThan(400);

  const envResponse = await envResponsePromise;
  expect(envResponse.status(), 'Tenant environment endpoint should succeed').toBeLessThan(400);
  const envPayload = await envResponse.json();
  expect(envPayload?.type, 'Tenant environment payload must resolve as tenant').toBe('tenant');

  await assertAppBooted(page);
  await waitForLanding(page, ['/', '/home', '/invites', '/convites', '/profile']);
  await logLandingHref(page, 'tenant');

  expect(collectors.runtimeErrors, `Unexpected runtime errors:\n${collectors.runtimeErrors.join('\n')}`).toEqual([]);
  expect(collectors.failedRequests, `Failed requests:\n${collectors.failedRequests.join('\n')}`).toEqual([]);
});
