/**
 * E2E test: verifies that a custom user-agent header passed via the scrape
 * API is actually used by the Playwright browser context.
 *
 * Run with: npx tsx __tests__/user-agent-override.test.ts
 * (from apps/playwright-service-ts/)
 *
 * Requires the playwright-service to be running on PORT (default 3000).
 */

import http from 'node:http';

const PLAYWRIGHT_SERVICE_URL = process.env.PLAYWRIGHT_SERVICE_URL || 'http://localhost:3000';
const ECHO_SERVER_PORT = 9877;

async function runTest(): Promise<void> {
  // 1. Start a local echo server that captures the User-Agent header
  let capturedUserAgent = '';

  const echoServer = http.createServer((req, res) => {
    capturedUserAgent = req.headers['user-agent'] || '';
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body>Hello</body></html>');
  });

  await new Promise<void>((resolve) => echoServer.listen(ECHO_SERVER_PORT, resolve));
  console.log(`Echo server listening on port ${ECHO_SERVER_PORT}`);

  try {
    const customUA = 'FirecrawlTestBot/1.0 (custom-user-agent-e2e-test)';

    // 2. Call the playwright scrape endpoint with a custom user-agent
    const response = await fetch(`${PLAYWRIGHT_SERVICE_URL}/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: `http://localhost:${ECHO_SERVER_PORT}`,
        timeout: 10000,
        headers: {
          'user-agent': customUA,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Scrape failed: ${response.status} ${await response.text()}`);
    }

    // 3. Verify the echo server received our custom user-agent
    if (capturedUserAgent !== customUA) {
      console.error(`❌ FAIL: Expected user-agent "${customUA}", got "${capturedUserAgent}"`);
      process.exit(1);
    }

    console.log(`✅ PASS: Custom user-agent was correctly used by Playwright`);
    console.log(`   Captured: ${capturedUserAgent}`);
  } finally {
    echoServer.close();
  }
}

runTest().catch((err) => {
  console.error('❌ Test error:', err.message);
  process.exit(1);
});
