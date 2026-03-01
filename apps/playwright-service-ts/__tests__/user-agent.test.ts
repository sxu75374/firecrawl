import express from 'express';
import http from 'http';

/**
 * E2E test: verify that the playwright-service respects a custom user-agent
 * header supplied in the scrape request body.
 *
 * Strategy:
 *   1. Start a tiny HTTP server that echoes the request's User-Agent header.
 *   2. POST /scrape to the playwright-service with a custom user-agent header.
 *   3. Assert the echoed User-Agent matches the custom value.
 *
 * Requirements:
 *   - The playwright-service must be running (default: http://localhost:3003).
 *     Set PLAYWRIGHT_SERVICE_URL to override.
 *   - Playwright browsers must be installed.
 */

const PLAYWRIGHT_SERVICE_URL = process.env.PLAYWRIGHT_SERVICE_URL || 'http://localhost:3003';
const ECHO_PORT = 0; // OS-assigned

function startEchoServer(): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const app = express();
    app.get('/', (req, res) => {
      res.json({ userAgent: req.headers['user-agent'] });
    });
    const server = app.listen(ECHO_PORT, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

async function scrapeWithHeaders(url: string, headers?: Record<string, string>) {
  const res = await fetch(`${PLAYWRIGHT_SERVICE_URL}/scrape`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, headers, timeout: 10000 }),
  });
  if (!res.ok) {
    throw new Error(`Scrape request failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

describe('user-agent header passthrough', () => {
  let echoServer: http.Server;
  let echoPort: number;

  beforeAll(async () => {
    const echo = await startEchoServer();
    echoServer = echo.server;
    echoPort = echo.port;
  });

  afterAll(() => {
    echoServer?.close();
  });

  it('should use custom user-agent when provided in headers', async () => {
    const customUA = 'FirecrawlTest/1.0 CustomAgent';
    const result = await scrapeWithHeaders(
      `http://127.0.0.1:${echoPort}/`,
      { 'user-agent': customUA },
    );
    // The echo server returns JSON with the user-agent, which is embedded
    // in the scraped page content.
    expect(result.content).toContain(customUA);
  }, 30000);

  it('should use default user-agent when none provided in headers', async () => {
    const result = await scrapeWithHeaders(`http://127.0.0.1:${echoPort}/`);
    // Should NOT contain our custom UA — should be a browser-like UA
    expect(result.content).not.toContain('FirecrawlTest/1.0');
    // Should contain some user-agent (the random one from user-agents package)
    expect(result.content).toContain('userAgent');
  }, 30000);
});
