const { defineConfig } = require('@playwright/test');

const ignoreHttpsErrors = process.env.PLAYWRIGHT_IGNORE_HTTPS_ERRORS === 'true';
const browserChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL || undefined;

module.exports = defineConfig({
  testDir: './tests',
  timeout: 120000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    ignoreHTTPSErrors: ignoreHttpsErrors,
    headless: true,
    ...(browserChannel ? { channel: browserChannel } : {}),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  }
});
