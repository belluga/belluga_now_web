const { test, expect } = require('@playwright/test');

const landlordUrl = process.env.NAV_LANDLORD_URL;
const tenantUrl = process.env.NAV_TENANT_URL;
const ENV_ENDPOINT_PATH = '/api/v1/environment';
const ENV_WAIT_TIMEOUT_MS = 90000;

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

function formatCollectorDump(collectors) {
  const failedRequests = collectors.failedRequests.join('\n') || '(none)';
  const runtimeErrors = collectors.runtimeErrors.join('\n') || '(none)';
  const consoleErrors = collectors.consoleErrors.join('\n') || '(none)';
  return `Failed requests:\n${failedRequests}\nRuntime errors:\n${runtimeErrors}\nConsole errors:\n${consoleErrors}`;
}

function isEnvironmentGetRequest(request) {
  return request.url().includes(ENV_ENDPOINT_PATH) && request.method() === 'GET';
}

async function waitForEnvironmentResponse(page, lane, collectors) {
  const responsePromise = page
    .waitForResponse((response) => isEnvironmentGetRequest(response.request()), { timeout: ENV_WAIT_TIMEOUT_MS })
    .then((response) => ({ type: 'response', response }))
    .catch((error) => ({ type: 'responseTimeout', error }));

  const requestFailedPromise = page
    .waitForEvent('requestfailed', { predicate: isEnvironmentGetRequest, timeout: ENV_WAIT_TIMEOUT_MS })
    .then((request) => ({ type: 'requestFailed', request }))
    .catch(() => ({ type: 'requestFailedTimeout' }));

  const outcome = await Promise.race([responsePromise, requestFailedPromise]);

  if (outcome.type === 'requestFailed') {
    const request = outcome.request;
    const message = request.failure()?.errorText || 'unknown request failure';
    throw new Error(
      `[nav][${lane}] environment request failed before response: ${request.method()} ${request.url()} (${message})\n${formatCollectorDump(collectors)}`
    );
  }

  if (outcome.type === 'responseTimeout') {
    throw new Error(
      `[nav][${lane}] timed out waiting for ${ENV_ENDPOINT_PATH} response: ${outcome.error?.message || 'timeout'}\n${formatCollectorDump(collectors)}`
    );
  }

  const envResponse = outcome.response;
  const status = envResponse.status();
  if (status >= 400) {
    let bodyPreview = '';
    try {
      bodyPreview = (await envResponse.text()).slice(0, 500);
    } catch (_) {
      bodyPreview = '';
    }
    throw new Error(
      `[nav][${lane}] environment response returned HTTP ${status}: ${envResponse.url()}${bodyPreview ? `\nBody preview:\n${bodyPreview}` : ''}\n${formatCollectorDump(collectors)}`
    );
  }

  return envResponse;
}

async function assertAppBooted(page) {
  await expect(page.locator('body')).toBeVisible({ timeout: 20000 });
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

  const response = await page.goto(landlordUrl, { waitUntil: 'domcontentloaded' });
  expect(response, 'Landlord response should be available').not.toBeNull();
  expect(response.status(), 'Landlord response should be successful').toBeLessThan(400);

  const envResponse = await waitForEnvironmentResponse(page, 'landlord', collectors);
  const envPayload = await envResponse.json();
  expect(envPayload?.type, 'Landlord environment payload must resolve as landlord').toBe('landlord');

  await assertAppBooted(page);
  await waitForLanding(page, ['/', '/landlord', '/home', '/invites', '/convites', '/profile']);
  await logLandingHref(page, 'landlord');

  expect(collectors.runtimeErrors, `Unexpected runtime errors:\n${collectors.runtimeErrors.join('\n')}`).toEqual([]);
  expect(collectors.failedRequests, `Failed requests:\n${collectors.failedRequests.join('\n')}`).toEqual([]);
  expect(collectors.consoleErrors, `Console errors:\n${collectors.consoleErrors.join('\n')}`).toEqual([]);
});

test('tenant domain bootstraps as tenant and navigates to tenant routes', async ({ page }) => {
  const collectors = installFailureCollectors(page);

  const response = await page.goto(tenantUrl, { waitUntil: 'domcontentloaded' });
  expect(response, 'Tenant response should be available').not.toBeNull();
  expect(response.status(), 'Tenant response should be successful').toBeLessThan(400);

  const envResponse = await waitForEnvironmentResponse(page, 'tenant', collectors);
  const envPayload = await envResponse.json();
  expect(envPayload?.type, 'Tenant environment payload must resolve as tenant').toBe('tenant');

  await assertAppBooted(page);
  await waitForLanding(page, ['/', '/home', '/invites', '/convites', '/profile']);
  await logLandingHref(page, 'tenant');

  expect(collectors.runtimeErrors, `Unexpected runtime errors:\n${collectors.runtimeErrors.join('\n')}`).toEqual([]);
  expect(collectors.failedRequests, `Failed requests:\n${collectors.failedRequests.join('\n')}`).toEqual([]);
  expect(collectors.consoleErrors, `Console errors:\n${collectors.consoleErrors.join('\n')}`).toEqual([]);
});
